import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import {
    ChatMessage,
    ExtensionConfig,
    WebviewToExtensionMessage,
    AtSuggestionItem
} from './types';
import { OllamaService } from './services/ollamaService';
import { IntentRouter } from './router/intentRouter';
import { LoopDetector } from './services/loopDetector';
import { AGENT_TOOLS, executeToolCall, RAGTools, FileTools, DiagnosticTools } from './tools';
import { enhancePromptWithCloud } from './cloudFilter';
import { DiffService } from './services/diffService';
import { RulesService } from './services/rulesService';
import { ProjectProfiler } from './services/projectProfiler';
import { SkillMatcher } from './services/skillMatcher';
import { SkillCatalogService } from './services/skillCatalogService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'vibe-coding-local.chatView';
    private _view?: vscode.WebviewView;
    private ollamaService: OllamaService;
    private intentRouter: IntentRouter;
    private loopDetector: LoopDetector;
    private conversationHistory: ChatMessage[] = [];
    // FIX: Flag para cancelar el loop de herramientas en cualquier momento
    private isCancelled: boolean = false;
    // Límite de mensajes en historial (sliding window para evitar context overflow)
    private static readonly MAX_HISTORY_MESSAGES = 30;

    constructor(private readonly context: vscode.ExtensionContext) {
        const config = this.getExtensionConfig();
        this.ollamaService = new OllamaService(config);
        this.intentRouter = new IntentRouter(config);
        this.loopDetector = new LoopDetector(this.ollamaService);
        this.loadHistory();
    }

    private getExtensionConfig(): ExtensionConfig {
        const cfg = vscode.workspace.getConfiguration('vibe-coding-local');
        return {
            ollamaHost: cfg.get<string>('ollamaHost', 'http://127.0.0.1:11434'),
            codingModel: cfg.get<string>('codingModel', 'qwen3-coder-cpu:latest'),
            reasoningModel: cfg.get<string>('reasoningModel', 'deepseek-r1:14b'),
            visionModel: cfg.get<string>('visionModel', 'llama3.2-vision:11b'),
            embeddingModel: cfg.get<string>('embeddingModel', 'nomic-embed-text:latest'),
            cloudFilterEnabled: cfg.get<boolean>('cloudFilterEnabled', false), // FIX: default false (consistente)
            cloudApiUrl: cfg.get<string>('cloudApiUrl', 'https://api.openai.com/v1/chat/completions'),
            cloudApiKey: cfg.get<string>('cloudApiKey', ''),
            cloudModel: cfg.get<string>('cloudModel', 'gpt-4o-mini'),
            maxToolRecursionDepth: cfg.get<number>('maxToolRecursionDepth', 10), // FIX: 5 -> 10
            ragTopK: cfg.get<number>('ragTopK', 4),
            enableStreaming: cfg.get<boolean>('enableStreaming', true),
            skillsPath: cfg.get<string>('skillsPath'),
            maxActiveSkills: cfg.get<number>('maxActiveSkills', 2),
            enableAutoSkills: cfg.get<boolean>('enableAutoSkills', true),
            skillsActivationMode: cfg.get<'on-demand' | 'always' | 'disabled'>('skillsActivationMode', 'on-demand'),
            reasoningUseGpu: cfg.get<boolean>('reasoningUseGpu', false)
        };
    }

    private async getSystemPrompt(): Promise<ChatMessage> {
        // Sistema prompt mejorado: instrucciones explícitas de cómo usar las herramientas
        let systemText = `Eres VibeCoding Agent, un agente de desarrollo de software de élite integrado directamente en VS Code, con capacidades equivalentes a Cursor, Claude Code y Antigravity IDE.

Tienes acceso a herramientas reales del filesystem y terminal del usuario. REGLAS FUNDAMENTALES:

1. EXPLORAR ANTES DE ACTUAR: Antes de crear o editar cualquier archivo, usa 'listDirectory' para ver la estructura actual del proyecto y 'readFile' para leer el contenido exacto del archivo que vas a modificar.

2. EDITAR CON PRECISIÓN: Para editar archivos existentes, usa 'editFile' con el fragmento EXACTO que aparece en el archivo (cópialo de la salida de 'readFile'). NUNCA inventes el targetChunk.

3. CREAR CON RUTAS RELATIVAS: Usa rutas relativas (ej. 'src/components/Button.tsx') a menos que el workspace ya tenga una ruta absoluta definida.

4. VERIFICAR RESULTADOS: Después de crear o editar archivos, verifica con 'readFile' que el cambio quedó correcto. Después de comandos, revisa stdout/stderr.

5. HERRAMIENTAS DISPONIBLES:
   - readFile: leer archivos con números de línea
   - createFile: crear archivos nuevos con contenido
   - editFile: reemplazo quirúrgico en archivos existentes
   - listDirectory: explorar estructura del proyecto
   - runCommand: ejecutar comandos (npm, git, python, etc.)
   - analyzeActiveTerminal: capturar errores de la terminal
   - semanticSearch: búsqueda semántica vectorial en el código
   - generateProjectContext: generar resumen del proyecto
   - getWorkspaceDiagnostics: ver errores de TypeScript/linters
   - consultSkill: consultar skills especializadas del catálogo local

6. RESPONDE EN ESPAÑOL por defecto, a menos que el usuario escriba en inglés.`;

        // Inyectar reglas personalizadas del proyecto si existen
        const projectRules = await RulesService.loadProjectRules();
        if (projectRules) {
            systemText += `\n\n${projectRules}`;
        }

        return {
            role: 'system',
            content: systemText
        };
    }

    private async loadHistory() {
        const saved = this.context.workspaceState.get<ChatMessage[]>('chatHistoryV2');
        if (saved && saved.length > 0) {
            this.conversationHistory = saved;
        } else {
            this.conversationHistory = [await this.getSystemPrompt()];
        }
    }

    private async saveHistory() {
        // FIX: Sliding window — mantener system prompt + últimos MAX_HISTORY_MESSAGES mensajes
        // para evitar que el contexto exceda el context_length del modelo
        const MAX = ChatViewProvider.MAX_HISTORY_MESSAGES;
        if (this.conversationHistory.length > MAX + 1) {
            const systemMsg = this.conversationHistory[0];
            this.conversationHistory = [systemMsg, ...this.conversationHistory.slice(-(MAX))];
        }
        await this.context.workspaceState.update('chatHistoryV2', this.conversationHistory);
    }

    public async clearChat() {
        this.conversationHistory = [await this.getSystemPrompt()];
        this.loopDetector.reset();
        await this.saveHistory();
        if (this._view) {
            this._view.webview.postMessage({ type: 'clearChat' });
            this._view.webview.postMessage({
                type: 'addMessage',
                role: 'agent',
                content: '¡Hola! Soy tu agente VibeCoding local conectado a Ollama. He reiniciado la sesión. ¿Qué vamos a programar hoy?'
            });
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this.context.extensionUri
            ]
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // Actualizar contexto global del proyecto en segundo plano al iniciar
        this.checkAndUpdateContextInBackground();

        // Escuchar cambios de configuración para actualizar servicios
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('vibe-coding-local')) {
                const updatedConfig = this.getExtensionConfig();
                this.ollamaService.updateConfig(updatedConfig);
                this.intentRouter = new IntentRouter(updatedConfig);
            }
        });

        webviewView.webview.onDidReceiveMessage(async (data: WebviewToExtensionMessage) => {
            switch (data.type) {
                case 'ready':
                    this.sendInitialHistory(webviewView);
                    break;
                case 'sendMessage':
                    this.isCancelled = false; // Resetear flag antes de cada mensaje
                    await this.handleUserMessage(data.value, data.images);
                    break;
                case 'clearChat':
                    await this.clearChat();
                    break;
                case 'indexWorkspace':
                    await this.handleIndexWorkspace();
                    break;
                case 'analyzeTerminal':
                    await this.handleAnalyzeTerminal();
                    break;
                case 'requestAtSuggestions':
                    await this.handleAtSuggestions(data.query);
                    break;
                case 'openNativeDiff':
                    await DiffService.getInstance().showNativeDiff(data.filePath, data.oldText, data.newText);
                    break;
                // FIX: Implementar cancelAgent que antes estaba definido en tipos pero sin handler
                case 'cancelAgent':
                    this.isCancelled = true;
                    this.postBadge('Agente', 'error', '⛔ Ejecución cancelada por el usuario.');
                    this.setBusy(false);
                    break;
            }
        });
    }

    private sendInitialHistory(webviewView: vscode.WebviewView) {
        if (this.conversationHistory.length > 1) {
            for (const msg of this.conversationHistory) {
                if (msg.role !== 'system' && msg.role !== 'tool') {
                    const uiContent = msg.original_content || msg.content;
                    webviewView.webview.postMessage({
                        type: 'addMessage',
                        role: msg.role === 'user' ? 'user' : 'agent',
                        content: uiContent,
                        images: msg.images
                    });
                }
            }
        } else {
            webviewView.webview.postMessage({
                type: 'addMessage',
                role: 'agent',
                content: '¡Hola! Soy tu agente VibeCoding Local potenciado por **Qwen Coder**, **DeepSeek R1**, **Llama 3.2 Vision** y **Nomic Embeddings** con streaming en tiempo real.\n\nPuedes dictarme por voz (🎙️), adjuntar imágenes (📎), autocompletar contexto con `@` o usar el clic derecho en tu código.'
            });
        }
    }

    private async checkAndUpdateContextInBackground() {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) return;
            const rootPath = workspaceFolders[0].uri.fsPath;
            const contextoPath = path.join(rootPath, 'contexto', 'contexto_proyecto.md');
            
            let needsUpdate = true;
            if (fs.existsSync(contextoPath)) {
                const stats = await fs.promises.stat(contextoPath);
                const hoursSinceUpdate = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);
                if (hoursSinceUpdate < 6) {
                    needsUpdate = false;
                }
            }

            if (needsUpdate) {
                console.log('[VibeCoding] Actualizando contexto del proyecto en segundo plano...');
                await FileTools.generateProjectContext();
            }
        } catch (error) {
            console.error('[VibeCoding] Error auto-actualizando contexto:', error);
        }
    }

    /**
     * Permite invocar al agente desde comandos de menú contextual o atajos
     */
    public async triggerDirectAction(prompt: string) {
        if (this._view) {
            await this.handleUserMessage(prompt);
        }
    }

    private async handleUserMessage(userText: string, images?: string[]) {
        if (!this._view) return;

        this.setBusy(true, 'Procesando solicitud...');

        try {
            const config = this.getExtensionConfig();
            let activeContext = '';
            
            // Inyectar explícitamente el nombre de la carpeta/proyecto abierto
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                const currentWorkspace = workspaceFolders[0];
                activeContext += `[PROYECTO / ESPACIO DE TRABAJO ACTUAL]: "${currentWorkspace.name}" (Ruta: ${currentWorkspace.uri.fsPath})\n\n`;
            } else {
                activeContext += `[ESPACIO DE TRABAJO ACTUAL]: Ninguna carpeta abierta en VS Code.\n\n`;
            }

            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                activeContext += `[Archivo abierto en editor: ${activeEditor.document.fileName}]\n`;
                const selection = activeEditor.selection;
                if (!selection.isEmpty) {
                    const selectedText = activeEditor.document.getText(selection);
                    activeContext += `[Código seleccionado (${selection.start.line + 1}-${selection.end.line + 1})]:\n\`\`\`\n${selectedText}\n\`\`\`\n\n`;
                }
            }

            // Cargar contexto global del proyecto si existe
            const globalContext = await FileTools.loadProjectContext();
            if (globalContext) {
                activeContext += `[Contexto Global del Proyecto]:\n${globalContext}\n\n`;
            }

            // Inyectar reglas locales si existen
            const projectRules = await RulesService.loadProjectRules();
            if (projectRules) {
                activeContext += `${projectRules}\n\n`;
            }

            // Inyectar Skills Congruentes con el Proyecto y la Petición SOLO cuando el usuario lo indique
            try {
                const isSkillRequested = SkillMatcher.isSkillRequestedByUser(userText);
                const activationMode = config.skillsActivationMode || 'on-demand';

                if (activationMode === 'always' || (activationMode === 'on-demand' && isSkillRequested)) {
                    this.postBadge('Analizando Skills', 'running', '🔍 Analizando catálogo de skills para identificar solo las estrictamente necesarias...');
                    const projectProfile = await ProjectProfiler.analyzeCurrentProject();
                    const matchedSkills = await SkillMatcher.matchSkills(userText, projectProfile, config.maxActiveSkills || 2, isSkillRequested);
                    if (matchedSkills.length > 0) {
                        for (const skill of matchedSkills) {
                            activeContext += `\n<guia_especializada nombre="${skill.name}">\n` +
                                `[INSTRUCCIÓN DEL SISTEMA: La siguiente es una guía técnica/metodológica de referencia sobre "${skill.name}". ` +
                                `Úsala ÚNICAMENTE como conocimiento interno de apoyo para fundamentar tu razonamiento o código. ` +
                                `ESTÁ ESTRICTAMENTE PROHIBIDO copiar, transcribir, listar o volcar este texto o comandos en tu respuesta. ` +
                                `Enfócate exclusivamente en responder la petición del usuario aplicando estas directrices.]\n\n` +
                                `${skill.content}\n` +
                                `</guia_especializada>\n\n`;
                            this.postBadge('Skill Activa', 'success', `🎯 Habilidad: ${skill.name} (${(skill.relevanceScore * 100).toFixed(0)}% congruencia necesaria con ${projectProfile.projectName})`, {
                                skillId: skill.id,
                                reason: skill.reason
                            });
                        }
                    } else if (isSkillRequested) {
                        this.postBadge('Skills Analizadas', 'success', 'ℹ️ Se analizó el catálogo completo de skills: ninguna es estrictamente necesaria para esta tarea.');
                    }
                }
            } catch (err) {
                console.error('[VibeCoding] Error seleccionando skills:', err);
            }

            // 1. Enrutamiento de Intención
            const routing = this.intentRouter.route(userText, images);
            console.log(`[IntentRouter] Decisión: ${routing.intent} -> ${routing.targetModel} (${routing.reason})`);

            // 2. Renderizar mensaje de usuario en UI
            this._view.webview.postMessage({
                type: 'addMessage',
                role: 'user',
                content: userText,
                images: images
            });

            // 3. Orquestación armónica según la intención
            if (routing.intent === 'VISION' && images && images.length > 0) {
                await this.processVisionTurn(userText, images, activeContext, routing.targetModel);
            } else if (routing.intent === 'REASONING') {
                await this.processReasoningTurn(userText, activeContext, routing.targetModel, routing.enhancedSystemPrompt);
            } else {
                // CODING_AGENT (por defecto con Tool Calling y Streaming)
                await this.processCodingAgentTurn(userText, activeContext, routing.targetModel, routing.enhancedSystemPrompt);
            }
        } catch (error: any) {
            this._view.webview.postMessage({
                type: 'addMessage',
                role: 'error',
                content: `Error al procesar: ${error.message}`
            });
        } finally {
            this.setBusy(false);
        }
    }

    private async processVisionTurn(userText: string, images: string[], activeContext: string, model: string) {
        this.postBadge('Llama Vision', 'running', 'Analizando imágenes, diagramas o mockups adjuntos...');
        const visionPrompt = `${userText || 'Analiza esta imagen y describe los componentes visuales, estructura o código necesario.'}\n${activeContext ? `\nContexto del proyecto:\n${activeContext}` : ''}`;
        const analysis = await this.ollamaService.analyzeVision(visionPrompt, images);
        
        this.postBadge('Llama Vision', 'success', 'Análisis visual completado');
        this.addAgentMessage(analysis, 'Llama 3.2 Vision');

        this.conversationHistory.push({
            role: 'user',
            content: userText,
            images: images
        });
        this.conversationHistory.push({
            role: 'assistant',
            content: analysis
        });
        await this.saveHistory();

        const lowerPrompt = userText.toLowerCase();
        const wantsCode = lowerPrompt.includes('crea') || lowerPrompt.includes('implementa') || lowerPrompt.includes('genera') || lowerPrompt.includes('construye') || lowerPrompt.includes('código') || lowerPrompt.includes('componente');
        
        if (wantsCode) {
            this.postBadge('Qwen Coder', 'running', 'Traduciendo análisis visual a código en el workspace con herramientas...');
            const codePrompt = `A partir del siguiente análisis de la imagen proporcionado por Llama Vision, procede a implementar o crear los archivos necesarios usando tus herramientas (createFile, editFile, readFile, etc.):\n\n${analysis}`;
            
            this.conversationHistory.push({
                role: 'user',
                content: codePrompt
            });
            await this.saveHistory();

            const config = this.getExtensionConfig();
            await this.executeAgentLoop(config.codingModel, 0);
        }
    }

    private async processReasoningTurn(
        userText: string,
        activeContext: string,
        model: string,
        systemPrompt?: string
    ) {
        this.postBadge('DeepSeek R1', 'running', 'Razonamiento profundo y análisis en curso...');

        // deepseek-r1:14b: context_length del modelo = 131,072 tokens.
        // num_ctx=32768 en ollamaService asegura espacio suficiente.
        const MAX_CONTEXT_CHARS = 100_000;
        const truncatedContext = activeContext.length > MAX_CONTEXT_CHARS
            ? activeContext.substring(0, MAX_CONTEXT_CHARS) + '\n\n[...contexto truncado por límite...]'
            : activeContext;

        // Construir prompt estructurado asegurando que la petición del usuario no se pierda ni se confunda con skills
        let fullPrompt = '';
        if (truncatedContext && truncatedContext.trim().length > 0) {
            fullPrompt = `<contexto_referencia>\n${truncatedContext}\n</contexto_referencia>\n\n` +
                `### SOLICITUD DEL USUARIO:\n${userText}\n\n` +
                `[INSTRUCCIÓN FINAL OBLIGATORIA: Responde de forma directa, exhaustiva y estructurada a la SOLICITUD DEL USUARIO anterior. ` +
                `Aplica el conocimiento del contexto internamente; NO transcribas, copies, ni resumas las guías de referencia.]`;
        } else {
            fullPrompt = userText;
        }

        if (this._view) {
            this._view.webview.postMessage({
                type: 'streamStart',
                role: 'agent',
                model: 'DeepSeek R1'
            });
        }

        const effectiveSystemPrompt = systemPrompt || 
            'Eres DeepSeek R1, un analista de sistemas, arquitecto de software y consultor senior experto. ' +
            'Responde con rigor analítico, pensamiento crítico y una estructura clara y detallada. ' +
            'NUNCA transcribas ni recites guías internas o metodologías en crudo: aplica tu criterio directamente para responder a la solicitud del usuario.';

        const reasoning = await this.ollamaService.reasonStream(
            fullPrompt,
            (token) => {
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'streamToken',
                        token: token
                    });
                }
            },
            effectiveSystemPrompt,
            false,
            this.conversationHistory
        );

        if (this._view) {
            this._view.webview.postMessage({
                type: 'streamEnd',
                content: reasoning
            });
        }
        
        this.postBadge('DeepSeek R1', 'success', 'Razonamiento finalizado');

        // Guardar historial limpio sin duplicar skills
        this.conversationHistory.push({
            role: 'user',
            content: userText
        });
        this.conversationHistory.push({
            role: 'assistant',
            content: reasoning
        });
        await this.saveHistory();
    }

    private async processCodingAgentTurn(
        userText: string,
        activeContext: string,
        model: string,
        enhancedSystemPrompt?: string
    ) {
        const config = this.getExtensionConfig();
        let promptToSend = userText;

        // Opcional: Enriquecer con filtro Cloud si está activado
        if (config.cloudFilterEnabled) {
            this.postBadge('Cloud Filter', 'running', 'Optimizando prompt con IA en la Nube (respetando límites de cuota)...');
            const historySummary = this.conversationHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).slice(-4).join('\n');
            const cloudResult = await enhancePromptWithCloud(userText, activeContext, historySummary);
            promptToSend = cloudResult.enhancedPrompt;
            if (cloudResult.providerUsed) {
                this.postBadge('Cloud Filter', 'success', `Super Prompt generado con ${cloudResult.providerUsed} | Cuota: ${cloudResult.usageInfo}`);
            }
        }

        // Agregar al historial de forma limpia (SOLO la petición del usuario, sin ensuciar la memoria con megabytes de skills)
        this.conversationHistory.push({
            role: 'user',
            content: promptToSend,
            original_content: userText
        });
        await this.saveHistory();

        // Iniciar bucle de ejecución de herramientas pasando el contexto del turno
        await this.executeAgentLoop(model, 0, activeContext, enhancedSystemPrompt);
    }

    private async executeAgentLoop(
        model: string,
        depth: number,
        activeContext?: string,
        enhancedSystemPrompt?: string
    ) {
        const config = this.getExtensionConfig();

        // FIX: Verificar cancelación antes de cada iteración
        if (this.isCancelled) {
            console.log('[VibeCoding] Loop cancelado por el usuario.');
            return;
        }

        if (depth >= config.maxToolRecursionDepth) {
            this.addAgentMessage(
                `⚠️ Se alcanzó el límite de ${config.maxToolRecursionDepth} pasos del agente. ` +
                `Si la tarea está incompleta, describe qué queda por hacer y continuaré.`,
                'Qwen Coder'
            );
            return;
        }

        // FIX: Indicador de progreso — el usuario ve en qué paso va el agente
        if (depth > 0) {
            this.postBadge('Agente', 'running', `⚙️ Paso ${depth + 1}/${config.maxToolRecursionDepth} — Continuando razonamiento...`);
        }

        this.postBadge('Qwen Coder', 'running', 'Generando respuesta / evaluando herramientas...');

        let assistantMsg: ChatMessage;
        let toolCalls: any[] = [];

        if (this._view) {
            this._view.webview.postMessage({
                type: 'streamStart',
                role: 'agent',
                model: 'Qwen Coder'
            });
        }

        // Construir mensajes para el turno actual:
        // FIX: Sliding window para evitar que la acumulación de historial desborde el procesamiento de CPU en Ollama
        let messagesToSend = this.conversationHistory.map(m => ({ ...m }));
        if (messagesToSend.length > 12) {
            const systemMsg = messagesToSend.find(m => m.role === 'system');
            const recentMsgs = messagesToSend.slice(-10);
            messagesToSend = systemMsg && !recentMsgs.some(m => m === systemMsg)
                ? [systemMsg, ...recentMsgs]
                : recentMsgs;
        }

        if (messagesToSend.length > 0 && messagesToSend[0].role === 'system') {
            let enrichedSystemContent = enhancedSystemPrompt || messagesToSend[0].content;
            if (activeContext && activeContext.trim().length > 0) {
                enrichedSystemContent += `\n\n<contexto_del_proyecto>\n${activeContext}\n</contexto_del_proyecto>\n\n` +
                    `[REGLA DE CONTEXTO: Las guías y archivos del contexto son de referencia técnica interna. ` +
                    `Nunca transcribas ni recites las guías al usuario; responde a su solicitud directamente aplicando el contexto.]`;
            }
            messagesToSend[0].content = enrichedSystemContent;
        }

        const streamResult = await this.ollamaService.chatStream(
            model,
            messagesToSend,
            AGENT_TOOLS,
            (token) => {
                if (this._view) {
                    this._view.webview.postMessage({
                        type: 'streamToken',
                        token: token
                    });
                }
            }
        );

        assistantMsg = streamResult.message;
        toolCalls = streamResult.toolCalls || [];

        if (this._view) {
            this._view.webview.postMessage({
                type: 'streamEnd',
                content: assistantMsg.content,
                toolCalls: toolCalls
            });
        }

        this.conversationHistory.push(assistantMsg);
        await this.saveHistory();

        if (toolCalls.length > 0) {
            for (const toolCall of toolCalls) {
                const tName = toolCall.function?.name || 'unknown';
                let tArgs = toolCall.function?.arguments || {};
                if (typeof tArgs === 'string') {
                    try {
                        tArgs = JSON.parse(tArgs);
                    } catch {
                        tArgs = { raw: tArgs };
                    }
                }

                this.postBadge(tName, 'running', `Ejecutando herramienta ${tName}...`, tArgs);

                const result = await executeToolCall(tName, tArgs, this.ollamaService);

                this.postBadge(
                    tName,
                    result.success ? 'success' : 'error',
                    result.output,
                    tArgs
                );

                // Si la herramienta produjo un diff, emitir previsualización
                if (result.diff && this._view) {
                    this._view.webview.postMessage({
                        type: 'diffPreview',
                        filePath: result.diff.filePath,
                        oldText: result.diff.oldContent,
                        newText: result.diff.newContent
                    });
                }

                // Registrar en el detector de bucles
                const isLoopDetected = this.loopDetector.recordToolResult(tName, tArgs, result);

                // Agregar resultado de herramienta al historial
                this.conversationHistory.push({
                    role: 'tool',
                    name: tName,
                    content: result.output
                });
                await this.saveHistory();

                // CONTROL DE BUCLES Y RECUPERACIÓN CON DEEPSEEK R1
                if (isLoopDetected) {
                    this.postBadge('Loop Recovery', 'running', '⚠️ Bucle o fallos reiterados detectados. Invocando a DeepSeek R1 para replanificar...');
                    
                    const recoveryPlan = await this.loopDetector.triggerDeepSeekRecovery(
                        'Resolver la tarea actual del usuario corrigiendo los fallos de herramientas.',
                        `Última herramienta: ${tName} con argumentos ${JSON.stringify(tArgs)}.`
                    );

                    this.postBadge('DeepSeek Recovery Plan', 'success', recoveryPlan.revisedPromptForAgent);

                    this.conversationHistory.push({
                        role: 'system',
                        content: `[PLAN DE RECUPERACIÓN DEEPSEEK R1]:\n${recoveryPlan.revisedPromptForAgent}\nSigue estas recomendaciones estrictamente para evitar repetir el mismo error.`
                    });
                    await this.saveHistory();
                }
            }

            // Continuar con el siguiente turno del agente pasando contexto
            await this.executeAgentLoop(model, depth + 1, activeContext, enhancedSystemPrompt);
        }
    }

    private async handleAtSuggestions(query: string) {
        if (!this._view) return;
        const normalizedQuery = query.toLowerCase().trim();
        const items: AtSuggestionItem[] = [];

        // 1. Sugerencia de Problemas/Diagnósticos LSP
        items.push({
            id: 'problems',
            label: '@problems',
            detail: 'Inyectar errores y advertencias de compilación del workspace',
            type: 'problems',
            insertText: DiagnosticTools.getDiagnosticsSummary()
        });

        // 2. Sugerencia de Terminal Activa
        items.push({
            id: 'terminal',
            label: '@terminal',
            detail: 'Inyectar el buffer reciente de la terminal activa',
            type: 'terminal',
            insertText: 'Por favor analiza el buffer de mi terminal activa.'
        });

        // 3. Sugerencia de Git Diff
        items.push({
            id: 'git',
            label: '@git',
            detail: 'Inyectar cambios no confirmados (git diff)',
            type: 'git',
            insertText: 'Por favor analiza mis cambios pendientes de git.'
        });

        // 4. Búsqueda de Skills Especializadas Locales
        try {
            const skills = SkillCatalogService.getInstance().getAllSkills();
            for (const skill of skills) {
                if (skill.id.toLowerCase().includes(normalizedQuery) || skill.name.toLowerCase().includes(normalizedQuery) || normalizedQuery.startsWith('skill')) {
                    items.push({
                        id: `skill:${skill.id}`,
                        label: `@skill:${skill.id}`,
                        detail: `🎯 Skill: ${skill.name} (${skill.tags.slice(0, 3).join(', ')})`,
                        type: 'skill',
                        insertText: `[Aplicar Skill: ${skill.name}]`
                    });
                }
            }
        } catch {}

        // 5. Búsqueda de archivos en el workspace
        try {
            const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 15);
            for (const file of files) {
                const relPath = vscode.workspace.asRelativePath(file);
                if (relPath.toLowerCase().includes(normalizedQuery) || !normalizedQuery) {
                    items.push({
                        id: file.fsPath,
                        label: `@${relPath}`,
                        detail: `Archivo del proyecto: ${path.basename(file.fsPath)}`,
                        type: 'file',
                        insertText: `[Archivo: ${relPath}]`
                    });
                }
            }
        } catch {}

        this._view.webview.postMessage({
            type: 'atSuggestionsResponse',
            items: items.slice(0, 15)
        });
    }

    private async handleIndexWorkspace() {
        if (!this._view) return;
        this.setBusy(true, 'Indexando workspace...');
        this._view.webview.postMessage({
            type: 'ragStatus',
            status: 'indexing',
            message: 'Iniciando indexación vectorial del workspace con nomic-embed-text...'
        });

        const result = await RAGTools.indexWorkspace(this.ollamaService, (msg) => {
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'ragStatus',
                    status: 'indexing',
                    message: msg
                });
            }
        });

        this._view.webview.postMessage({
            type: 'ragStatus',
            status: result.success ? 'ready' : 'error',
            message: result.message
        });

        this.setBusy(false);
    }

    private async handleAnalyzeTerminal() {
        if (!this._view) return;
        this.setBusy(true, 'Analizando terminal activa...');
        
        const terminalResult = await executeToolCall('analyzeActiveTerminal', {}, this.ollamaService);
        if (!terminalResult.success) {
            this.addAgentMessage(`No se pudo analizar la terminal: ${terminalResult.output}`, 'Qwen Coder');
            this.setBusy(false);
            return;
        }

        const prompt = `Por favor analiza el siguiente contenido y errores de mi terminal activa y proporciona una explicación clara y la solución:\n\n${terminalResult.output}`;
        await this.handleUserMessage(prompt);
    }

    private addAgentMessage(content: string, model: string = 'Qwen Coder') {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'addMessage',
                role: 'agent',
                content: content,
                model: model
            });
        }
    }

    private postBadge(toolName: string, status: 'running' | 'success' | 'error', message: string, args?: any) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'toolBadge',
                toolName,
                status,
                message,
                args
            });
        }
    }

    private setBusy(busy: boolean, text?: string) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'agentStatus',
                status: busy ? 'busy' : 'idle',
                text: text
            });
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));

        return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VibeCoding Local Agent</title>
    <link rel="stylesheet" href="${styleUri}">
</head>
<body>
    <div id="header">
        <div class="header-title">
            <span>⚡</span>
            <span>VibeCoding Local</span>
        </div>
        <div class="header-actions">
            <button id="rag-btn" class="btn-icon" title="Indexar código con nomic-embed-text">🔍 RAG</button>
            <button id="terminal-btn" class="btn-icon" title="Analizar errores de la terminal activa">🩺 Terminal</button>
            <button id="clear-btn" class="btn-icon" title="Limpiar conversación">🧹</button>
        </div>
    </div>

    <div id="chat-container"></div>

    <div id="footer">
        <div id="at-suggestions-menu" class="suggestions-menu" style="display: none;"></div>
        <div id="preview-attachments"></div>
        <div class="input-box-wrapper">
            <textarea id="message-input" placeholder="Pregunta, dicta o usa @ para autocompletar archivos/problemas..." rows="1"></textarea>
            <div class="toolbar-buttons">
                <input type="file" id="file-input" accept="image/*" multiple style="display: none;" />
                <button id="attach-btn" class="action-btn" title="Adjuntar imagen/mockup">📎</button>
                <button id="mic-btn" class="action-btn" title="Dictado por voz (Español)">🎙️</button>
                <!-- FIX: Botón de cancelación para detener el agente en cualquier momento -->
                <button id="cancel-btn" class="action-btn cancel-btn" title="Cancelar ejecución del agente" style="display:none;">⛔</button>
                <button id="send-btn" class="action-btn" title="Enviar">➤</button>
            </div>
        </div>
    </div>

    <script src="${scriptUri}"></script>
</body>
</html>`;
    }
}
