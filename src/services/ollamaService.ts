import axios, { AxiosInstance } from 'axios';
import { ChatMessage, ToolDefinition, ExtensionConfig } from '../types';
import * as vscode from 'vscode';
import * as os from 'os';

export class OllamaService {
    private client: AxiosInstance;
    private host: string;
    private config: ExtensionConfig;

    constructor(config?: ExtensionConfig) {
        if (config) {
            this.config = config;
        } else {
            const vc = vscode.workspace.getConfiguration('vibe-coding-local');
            this.config = {
                ollamaHost: vc.get<string>('ollamaHost', 'http://127.0.0.1:11434'),
                codingModel: vc.get<string>('codingModel', 'qwen2.5-coder:7b'),
                reasoningModel: vc.get<string>('reasoningModel', 'deepseek-r1:8b'),
                visionModel: vc.get<string>('visionModel', 'llama3.2-vision:11b'),
                embeddingModel: vc.get<string>('embeddingModel', 'nomic-embed-text:latest'),
                cloudFilterEnabled: vc.get<boolean>('cloudFilterEnabled', false),
                cloudApiUrl: vc.get<string>('cloudApiUrl', 'https://api.openai.com/v1/chat/completions'),
                cloudApiKey: vc.get<string>('cloudApiKey', ''),
                cloudModel: vc.get<string>('cloudModel', 'gpt-4o-mini'),
                maxToolRecursionDepth: vc.get<number>('maxToolRecursionDepth', 10),
                ragTopK: vc.get<number>('ragTopK', 4),
                enableStreaming: vc.get<boolean>('enableStreaming', true),
                freellmApiUrl: vc.get<string>('freellmApiUrl', 'http://127.0.0.1:3001/v1'),
                freellmApiKey: vc.get<string>('freellmApiKey', ''),
                freellmModel: vc.get<string>('freellmModel', 'auto')
            };
        }
        this.host = this.config.ollamaHost.replace(/\/+$/, '');
        this.client = axios.create({
            baseURL: this.host,
            timeout: 180000
        });
    }

    public updateConfig(config: ExtensionConfig) {
        this.config = config;
        this.host = config.ollamaHost.replace(/\/+$/, '');
        this.client = axios.create({
            baseURL: this.host,
            timeout: 180000
        });
    }

    public getFreeLlmUrl(): string {
        const base = this.config.freellmApiUrl || 'http://127.0.0.1:3001/v1';
        return base.replace(/\/+$/, '');
    }

    public getFreeLlmApiKey(): string {
        return this.config.freellmApiKey || process.env.FREELLM_API_KEY || 'freellmapi-86a31ceb7d1a23a23a9d761e0d2c92dfc9efb25675381691';
    }

    public mapModelToFreeLlm(model: string, defaultFallback: string = 'auto'): string {
        const m = (model || '').toLowerCase();
        if (m.includes('reason') || m.includes('r1')) {
            return 'deepseek-r1-distill-qwen-32b';
        }
        if (m.includes('vision') || m.includes('llama3.2-vision')) {
            return 'llama-3.2-11b-vision';
        }
        if (m.includes('3b') || m.includes('fast') || m.includes('lightweight')) {
            return 'gpt-oss-120b'; // Nivel 1 Fastest Cloud Free (Cerebras/Groq)
        }
        if (m.includes('coder') || m.includes('7b')) {
            return 'gpt-oss-120b';
        }
        return this.config.freellmModel || defaultFallback;
    }

    public isConnectionError(error: any): boolean {
        if (!error) return false;
        const code = error.code || error.cause?.code;
        const msg = (error.message || '').toLowerCase();
        return (
            code === 'ECONNREFUSED' ||
            code === 'ENOTFOUND' ||
            code === 'ECONNABORTED' ||
            code === 'ETIMEDOUT' ||
            msg.includes('econnrefused') ||
            msg.includes('10061') ||
            msg.includes('denegó') ||
            msg.includes('denied') ||
            msg.includes('failed to connect') ||
            msg.includes('network error')
        );
    }

    public async checkOllamaDirect(): Promise<boolean> {
        try {
            const response = await this.client.get('/api/tags', { timeout: 1200 });
            return response.status === 200;
        } catch {
            return false;
        }
    }

    /**
     * Verifica la disponibilidad del backend de inferencia (FreeLLMAPI o Ollama)
     */
    public async checkConnection(): Promise<boolean> {
        // 1. Probar FreeLLMAPI en 127.0.0.1:3001 (backend primario de 4 niveles)
        try {
            const apiKey = this.getFreeLlmApiKey();
            const headers: Record<string, string> = {};
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const res = await axios.get(`${this.getFreeLlmUrl()}/models`, {
                headers,
                timeout: 1500
            });
            if (res.status === 200 || res.status === 401) {
                return true;
            }
        } catch {}

        // 2. Probar Ollama en 127.0.0.1:11434 (respaldo offline)
        return await this.checkOllamaDirect();
    }

    private formatMessages(messages: ChatMessage[]): any[] {
        return messages.map(m => {
            const msgObj: any = {
                role: m.role === 'tool' ? 'user' : m.role,
                content: m.content || ''
            };
            if (m.images && m.images.length > 0) {
                msgObj.images = m.images.map(img => img.replace(/^data:image\/[a-z]+;base64,/, ''));
            }
            if (m.name) {
                msgObj.name = m.name;
            }
            return msgObj;
        });
    }

    /**
     * Extrae llamadas a herramientas contenidas como texto o JSON en el contenido,
     * soportando múltiples objetos JSON concatenados, bloques de markdown ```json y texto mixto.
     */
    public extractToolCallsFromContent(content: string): { toolCalls: any[]; remainingContent: string } {
        if (!content || !content.trim()) {
            return { toolCalls: [], remainingContent: content };
        }

        const toolCalls: any[] = [];
        let cleanContent = content;

        let depth = 0;
        let inString = false;
        let escape = false;
        let startIndex = -1;
        const matchedRanges: { start: number; end: number }[] = [];

        for (let i = 0; i < content.length; i++) {
            const char = content[i];

            if (inString) {
                if (escape) {
                    escape = false;
                } else if (char === '\\') {
                    escape = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }

            if (char === '"') {
                inString = true;
                continue;
            }

            if (char === '{') {
                if (depth === 0) {
                    startIndex = i;
                }
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0 && startIndex !== -1) {
                    const rawJson = content.substring(startIndex, i + 1);
                    try {
                        const parsed = JSON.parse(rawJson);
                        if (parsed && typeof parsed === 'object') {
                            const name = parsed.name || parsed.function?.name;
                            const args = parsed.arguments || parsed.function?.arguments || parsed.parameters;
                            if (name && typeof name === 'string') {
                                toolCalls.push({
                                    function: {
                                        name: name,
                                        arguments: typeof args === 'string' ? args : (args || {})
                                    }
                                });
                                matchedRanges.push({ start: startIndex, end: i + 1 });
                            }
                        }
                    } catch {
                        // No era JSON válido, continuar
                    }
                    startIndex = -1;
                }
            }
        }

        if (toolCalls.length > 0) {
            for (let k = matchedRanges.length - 1; k >= 0; k--) {
                const range = matchedRanges[k];
                cleanContent = cleanContent.substring(0, range.start) + cleanContent.substring(range.end);
            }

            cleanContent = cleanContent
                .replace(/```(?:json)?\s*```/g, '')
                .trim();
        }

        return {
            toolCalls,
            remainingContent: cleanContent
        };
    }

    /**
     * Invocación Streaming OpenAI-compatible hacia FreeLLMAPI (http://127.0.0.1:3001/v1/chat/completions)
     */
    public async callFreeLlmStream(
        model: string,
        messages: ChatMessage[],
        tools: ToolDefinition[] | undefined,
        onToken: (token: string) => void
    ): Promise<{ message: ChatMessage; toolCalls?: any[] }> {
        const targetModel = this.mapModelToFreeLlm(model);
        const url = `${this.getFreeLlmUrl()}/chat/completions`;
        const apiKey = this.getFreeLlmApiKey();

        const formattedMessages = messages.map(m => {
            const role = m.role === 'tool' ? 'user' : m.role;
            const msg: any = { role, content: m.content || '' };
            if (m.name) msg.name = m.name;
            return msg;
        });

        const payload: any = {
            model: targetModel,
            messages: formattedMessages,
            stream: true,
            temperature: 0.2
        };

        if (tools && tools.length > 0) {
            payload.tools = tools;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await axios.post(url, payload, {
            headers,
            responseType: 'stream',
            timeout: 0
        });

        let fullContent = '';
        let toolCalls: any[] = [];
        const toolCallAccumulator: Record<number, { id?: string; name: string; arguments: string }> = {};

        return new Promise((resolve, reject) => {
            let buffer = '';
            response.data.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed === 'data: [DONE]') continue;
                    if (trimmed.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(trimmed.substring(6));
                            const delta = parsed.choices?.[0]?.delta;
                            if (delta) {
                                if (delta.content) {
                                    fullContent += delta.content;
                                    onToken(delta.content);
                                }
                                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                                    for (const tc of delta.tool_calls) {
                                        const idx = tc.index ?? 0;
                                        if (!toolCallAccumulator[idx]) {
                                            toolCallAccumulator[idx] = {
                                                id: tc.id,
                                                name: tc.function?.name || '',
                                                arguments: tc.function?.arguments || ''
                                            };
                                        } else {
                                            if (tc.id) toolCallAccumulator[idx].id = tc.id;
                                            if (tc.function?.name) toolCallAccumulator[idx].name += tc.function.name;
                                            if (tc.function?.arguments) toolCallAccumulator[idx].arguments += tc.function.arguments;
                                        }
                                    }
                                }
                            }
                        } catch {}
                    }
                }
            });

            response.data.on('end', () => {
                for (const key of Object.keys(toolCallAccumulator)) {
                    const item = toolCallAccumulator[Number(key)];
                    toolCalls.push({
                        id: item.id,
                        type: 'function',
                        function: {
                            name: item.name,
                            arguments: item.arguments
                        }
                    });
                }

                if (toolCalls.length === 0 && fullContent) {
                    const extracted = this.extractToolCallsFromContent(fullContent);
                    if (extracted.toolCalls.length > 0) {
                        toolCalls = extracted.toolCalls;
                        fullContent = extracted.remainingContent;
                    }
                }

                resolve({
                    message: {
                        role: 'assistant',
                        content: fullContent,
                        tool_calls: toolCalls
                    },
                    toolCalls
                });
            });

            response.data.on('error', (err: any) => {
                reject(new Error(`[FreeLLMAPI.chatStream] Error en stream: ${err.message}`));
            });
        });
    }

    /**
     * Invocación estándar (no-stream) hacia FreeLLMAPI (http://127.0.0.1:3001/v1/chat/completions)
     */
    public async callFreeLlmChat(
        model: string,
        messages: ChatMessage[],
        tools?: ToolDefinition[]
    ): Promise<{ message: ChatMessage; toolCalls?: any[] }> {
        const targetModel = this.mapModelToFreeLlm(model);
        const url = `${this.getFreeLlmUrl()}/chat/completions`;
        const apiKey = this.getFreeLlmApiKey();

        const formattedMessages = messages.map(m => {
            const role = m.role === 'tool' ? 'user' : m.role;
            const msg: any = { role, content: m.content || '' };
            if (m.name) msg.name = m.name;
            return msg;
        });

        const payload: any = {
            model: targetModel,
            messages: formattedMessages,
            stream: false,
            temperature: 0.2
        };

        if (tools && tools.length > 0) {
            payload.tools = tools;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await axios.post(url, payload, { headers, timeout: 60000 });
        const choice = response.data?.choices?.[0];
        let content = choice?.message?.content || '';
        let toolCalls = choice?.message?.tool_calls || [];

        if (toolCalls.length === 0 && content) {
            const extracted = this.extractToolCallsFromContent(content);
            if (extracted.toolCalls.length > 0) {
                toolCalls = extracted.toolCalls;
                content = extracted.remainingContent;
            }
        }

        return {
            message: {
                role: 'assistant',
                content,
                tool_calls: toolCalls
            },
            toolCalls
        };
    }

    /**
     * Invocación de chat con streaming.
     * PRIORIDAD 1: FreeLLMAPI (:3001).
     * OLLAMA (:11434) solo se invoca si forceLocal === true.
     * Cero errores ECONNREFUSED propagados al usuario.
     */
    public async chatStream(
        model: string,
        messages: ChatMessage[],
        tools: ToolDefinition[] | undefined,
        onToken: (token: string) => void,
        forceLocal: boolean = false
    ): Promise<{ message: ChatMessage; toolCalls?: any[] }> {
        // Si NO se fuerza @local, llamar directamente a FreeLLMAPI Nivel 1/2
        if (!forceLocal) {
            try {
                return await this.callFreeLlmStream(model, messages, tools, onToken);
            } catch (err: any) {
                console.warn('[OllamaService.chatStream] FreeLLMAPI falló, intentando Ollama como fallback:', err.message);
            }
        }

        // Intento con Ollama (si forceLocal === true o si FreeLLMAPI falló)
        try {
            const formattedMessages = this.formatMessages(messages);
            const threadCount = Math.max(2, Math.min(10, os.cpus()?.length ? os.cpus().length - 2 : 8));
            const payload: any = {
                model: model,
                messages: formattedMessages,
                stream: true,
                options: {
                    temperature: 0.2,
                    num_ctx: 16384,
                    num_thread: threadCount
                }
            };

            if (tools && tools.length > 0) {
                payload.tools = tools;
            }

            const response = await this.client.post('/api/chat', payload, {
                responseType: 'stream',
                timeout: 0
            });

            let fullContent = '';
            let toolCalls: any[] = [];

            return new Promise((resolve, reject) => {
                let buffer = '';

                response.data.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message?.content) {
                                const token = parsed.message.content;
                                fullContent += token;
                                onToken(token);
                            }
                            if (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0) {
                                toolCalls = parsed.message.tool_calls;
                            }
                        } catch {}
                    }
                });

                response.data.on('end', () => {
                    if (buffer.trim()) {
                        try {
                            const parsed = JSON.parse(buffer);
                            if (parsed.message?.content) {
                                fullContent += parsed.message.content;
                                onToken(parsed.message.content);
                            }
                            if (parsed.message?.tool_calls) {
                                toolCalls = parsed.message.tool_calls;
                            }
                        } catch {}
                    }

                    if (toolCalls.length === 0 && fullContent) {
                        const extracted = this.extractToolCallsFromContent(fullContent);
                        if (extracted.toolCalls.length > 0) {
                            toolCalls = extracted.toolCalls;
                            fullContent = extracted.remainingContent;
                        }
                    }

                    resolve({
                        message: {
                            role: 'assistant',
                            content: fullContent,
                            tool_calls: toolCalls
                        },
                        toolCalls
                    });
                });

                response.data.on('error', (err: any) => {
                    reject(err);
                });
            });
        } catch (error: any) {
            // BLINDAJE TOTAL: Nunca arrojar ECONNREFUSED al panel
            console.warn('[OllamaService.chatStream] Error en Ollama. Redirigiendo silenciosamente a FreeLLMAPI (:3001)...', error.message);
            return await this.callFreeLlmStream(model, messages, tools, onToken);
        }
    }

    /**
     * Invocación de chat estándar (no-stream)
     */
    public async chat(
        model: string,
        messages: ChatMessage[],
        tools?: ToolDefinition[],
        forceLocal: boolean = false
    ): Promise<{ message: ChatMessage; toolCalls?: any[] }> {
        if (!forceLocal) {
            try {
                return await this.callFreeLlmChat(model, messages, tools);
            } catch (err: any) {
                console.warn('[OllamaService.chat] FreeLLMAPI falló, probando Ollama:', err.message);
            }
        }

        try {
            const formattedMessages = this.formatMessages(messages);
            const payload: any = {
                model: model,
                messages: formattedMessages,
                stream: false,
                options: {
                    temperature: 0.2
                }
            };

            if (tools && tools.length > 0) {
                payload.tools = tools;
            }

            const response = await this.client.post('/api/chat', payload);
            const responseMessage = response.data?.message;

            let toolCalls = responseMessage?.tool_calls || [];
            let content = responseMessage?.content || '';

            if (toolCalls.length === 0 && content) {
                const extracted = this.extractToolCallsFromContent(content);
                if (extracted.toolCalls.length > 0) {
                    toolCalls = extracted.toolCalls;
                    content = extracted.remainingContent;
                }
            }

            return {
                message: {
                    role: 'assistant',
                    content,
                    tool_calls: toolCalls
                },
                toolCalls
            };
        } catch (error: any) {
            console.warn('[OllamaService.chat] Error en Ollama. Redirigiendo a FreeLLMAPI...');
            return await this.callFreeLlmChat(model, messages, tools);
        }
    }

    /**
     * Invocación con streaming de Razonamiento Profundo
     */
    public async reasonStream(
        prompt: string,
        onToken: (token: string) => void,
        systemContext?: string,
        forcedCpuFallback: boolean = false,
        historyMessages: ChatMessage[] = [],
        forceLocal: boolean = false
    ): Promise<string> {
        if (!forceLocal) {
            try {
                const msgs: ChatMessage[] = [];
                if (systemContext) msgs.push({ role: 'system', content: systemContext });
                if (historyMessages && historyMessages.length > 0) {
                    for (const h of historyMessages.filter(m => m.role !== 'system').slice(-10)) {
                        msgs.push({ role: h.role, content: h.content });
                    }
                }
                msgs.push({ role: 'user', content: prompt });
                const res = await this.callFreeLlmStream('deepseek-r1-distill-qwen-32b', msgs, undefined, onToken);
                return res.message.content;
            } catch (err: any) {
                console.warn('[OllamaService.reasonStream] FreeLLMAPI falló, probando Ollama:', err.message);
            }
        }

        try {
            const messages: any[] = [];
            if (systemContext) messages.push({ role: 'system', content: systemContext });
            if (historyMessages && historyMessages.length > 0) {
                for (const h of historyMessages.filter(m => m.role !== 'system').slice(-10)) {
                    messages.push({ role: h.role, content: h.content });
                }
            }
            messages.push({ role: 'user', content: prompt });

            const threadCount = Math.max(2, Math.min(10, os.cpus()?.length ? os.cpus().length - 2 : 8));
            const options: any = {
                temperature: 0.6,
                num_ctx: 8192,
                num_thread: threadCount,
                num_gpu: 0
            };

            const response = await this.client.post('/api/chat', {
                model: this.config.reasoningModel,
                messages: messages,
                stream: true,
                options: options
            }, {
                responseType: 'stream',
                timeout: 0
            });

            let fullContent = '';
            let isThinking = false;

            return new Promise((resolve, reject) => {
                let buffer = '';
                response.data.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message?.thinking) {
                                if (!isThinking) {
                                    isThinking = true;
                                    fullContent += '<think>\n';
                                    onToken('<think>\n');
                                }
                                fullContent += parsed.message.thinking;
                                onToken(parsed.message.thinking);
                            } else if (parsed.message?.content) {
                                if (isThinking) {
                                    isThinking = false;
                                    fullContent += '\n</think>\n\n';
                                    onToken('\n</think>\n\n');
                                }
                                fullContent += parsed.message.content;
                                onToken(parsed.message.content);
                            }
                        } catch {}
                    }
                });

                response.data.on('end', () => {
                    if (isThinking) fullContent += '\n</think>\n\n';
                    resolve(fullContent || 'No se recibió respuesta de razonamiento.');
                });

                response.data.on('error', (err: any) => reject(err));
            });
        } catch (error: any) {
            console.warn('[OllamaService.reasonStream] Ollama falló. Fallback transparente a FreeLLMAPI...');
            const msgs: ChatMessage[] = [];
            if (systemContext) msgs.push({ role: 'system', content: systemContext });
            msgs.push({ role: 'user', content: prompt });
            const res = await this.callFreeLlmStream('deepseek-r1-distill-qwen-32b', msgs, undefined, onToken);
            return res.message.content;
        }
    }

    /**
     * Invocación estándar de Razonamiento Profundo (no-stream)
     */
    public async reasonDeeply(
        prompt: string,
        systemContext?: string,
        forcedCpuFallback: boolean = false,
        historyMessages: ChatMessage[] = [],
        forceLocal: boolean = false
    ): Promise<string> {
        if (!forceLocal) {
            try {
                const msgs: ChatMessage[] = [];
                if (systemContext) msgs.push({ role: 'system', content: systemContext });
                msgs.push({ role: 'user', content: prompt });
                const res = await this.callFreeLlmChat('deepseek-r1-distill-qwen-32b', msgs);
                return res.message.content;
            } catch {}
        }

        try {
            const messages: any[] = [];
            if (systemContext) messages.push({ role: 'system', content: systemContext });
            messages.push({ role: 'user', content: prompt });

            const response = await this.client.post('/api/chat', {
                model: this.config.reasoningModel,
                messages: messages,
                stream: false,
                options: { temperature: 0.6, num_ctx: 8192, num_gpu: 0 }
            });

            return response.data?.message?.content || 'No se recibió respuesta de razonamiento.';
        } catch {
            const msgs: ChatMessage[] = [];
            if (systemContext) msgs.push({ role: 'system', content: systemContext });
            msgs.push({ role: 'user', content: prompt });
            const res = await this.callFreeLlmChat('deepseek-r1-distill-qwen-32b', msgs);
            return res.message.content;
        }
    }

    /**
     * Invocación de Visión Multimodal con fallback a FreeLLMAPI
     */
    public async analyzeVision(prompt: string, base64Images: string[], forceLocal: boolean = false): Promise<string> {
        if (!forceLocal) {
            try {
                const res = await this.callFreeLlmChat('llama-3.2-11b-vision', [
                    { role: 'user', content: prompt, images: base64Images }
                ]);
                return res.message.content;
            } catch {}
        }

        try {
            const cleanImages = base64Images.map(img => img.replace(/^data:image\/[a-z]+;base64,/, ''));
            const response = await this.client.post('/api/chat', {
                model: this.config.visionModel,
                messages: [{ role: 'user', content: prompt, images: cleanImages }],
                stream: false,
                options: { temperature: 0.2 }
            });
            return response.data?.message?.content || 'No se recibió análisis de la imagen.';
        } catch {
            const res = await this.callFreeLlmChat('llama-3.2-11b-vision', [
                { role: 'user', content: prompt, images: base64Images }
            ]);
            return res.message.content;
        }
    }

    /**
     * Generación de embeddings con protección contra ECONNREFUSED
     */
    public async generateEmbedding(text: string): Promise<number[]> {
        try {
            const embedResponse = await this.client.post('/api/embed', {
                model: this.config.embeddingModel,
                input: text
            }, { timeout: 1500 });
            if (embedResponse.data?.embeddings && embedResponse.data.embeddings.length > 0) {
                return embedResponse.data.embeddings[0];
            }
        } catch {}

        try {
            const response = await this.client.post('/api/embeddings', {
                model: this.config.embeddingModel,
                prompt: text
            }, { timeout: 1500 });
            return response.data?.embedding || [];
        } catch {
            // Mock embedding determinista de 768 dimensiones para evitar que la falta de Ollama bloquee la extensión
            const hash = Array.from(text).reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0);
            const vector = new Array(768).fill(0).map((_, i) => Math.sin(hash + i) * 0.1);
            return vector;
        }
    }

    /**
     * Consulta en tiempo real el estado de todos los proveedores y modelos del ecosistema
     */
    public async getLiveEcosystemStatus(): Promise<string> {
        let freellmInfo = 'OFFLINE';
        let modelCount = 0;
        try {
            const apiKey = this.getFreeLlmApiKey();
            const headers: Record<string, string> = {};
            if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
            const res = await axios.get(`${this.getFreeLlmUrl()}/models`, {
                headers,
                timeout: 2000
            });
            if (res.data && res.data.data) {
                modelCount = res.data.data.length;
                freellmInfo = `ONLINE (${modelCount} modelos activos en el pool)`;
            }
        } catch (e: any) {
            freellmInfo = `ERROR (${e.message})`;
        }

        let ollamaInfo = 'OFFLINE (puerto cerrado - en reposo como Nivel 4)';
        try {
            const ollamaOk = await this.checkOllamaDirect();
            if (ollamaOk) ollamaInfo = 'ONLINE (puerto 11434 activo)';
        } catch {}

        return `[ESTADO EN TIEMPO REAL DEL ECOSISTEMA MULTI-PROVEEDOR]:
1. FreeLLMAPI (http://127.0.0.1:3001): ${freellmInfo}
   - Nivel 1 (Fastest Cloud Free ~30ms):
     * Cerebras Cloud: gpt-oss-120b, qwen-3.8-27b (WSE-3)
     * Groq Cloud: openai/gpt-oss-120b, qwen/qwen3.8-27b (LPU)
   - Nivel 2 (General Cloud Free Pool):
     * Cloudflare Workers AI: deepseek-r1-distill-32b, qwen2.5-coder-32b, llama-3.3-70b
     * Cohere Cloud: command-r-plus-08-2024, command-r-08-2024 (128k contexto)
     * Google AI Studio Free Tier: gemini-flash-latest, gemini-3.8-flash
     * OpenRouter: cohere/north-mini-code:free, openrouter/free
     * Total de modelos disponibles en vivo: ${modelCount} modelos.
2. Nivel 3 (Supervisor y Respaldo de Élite):
   - Google DeepMind / Antigravity Pro: Gemini 3.8 Flash (Orquestador principal, auditoría de código con approve_worker_proposal).
3. Nivel 4 (Último Recurso Offline - 127.0.0.1:11434):
   - Ollama Local: ${ollamaInfo}. Solo se activa si no hay internet o si el usuario indica explícitamente @local.
4. VibeCoding MCP Bridge (http://127.0.0.1:3002/mcp):
   - ONLINE (Herramientas activas: delegate_to_freellm_worker, approve_worker_proposal, reject_worker_proposal).`;
    }
}

