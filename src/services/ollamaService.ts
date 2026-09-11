import axios, { AxiosInstance } from 'axios';
import { ChatMessage, ToolDefinition, ExtensionConfig } from '../types';

import * as vscode from 'vscode';

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
                codingModel: vc.get<string>('codingModel', 'qwen3-coder-cpu:latest'),
                reasoningModel: vc.get<string>('reasoningModel', 'deepseek-r1:14b'),
                visionModel: vc.get<string>('visionModel', 'llama3.2-vision:11b'),
                embeddingModel: vc.get<string>('embeddingModel', 'nomic-embed-text:latest'),
                cloudFilterEnabled: vc.get<boolean>('cloudFilterEnabled', false), // FIX: default false (consistente en todos los módulos)
                cloudApiUrl: vc.get<string>('cloudApiUrl', 'https://api.openai.com/v1/chat/completions'),
                cloudApiKey: vc.get<string>('cloudApiKey', ''),
                cloudModel: vc.get<string>('cloudModel', 'gpt-4o-mini'),
                maxToolRecursionDepth: vc.get<number>('maxToolRecursionDepth', 5),
                ragTopK: vc.get<number>('ragTopK', 4),
                enableStreaming: vc.get<boolean>('enableStreaming', true)
            };
        }
        this.host = this.config.ollamaHost.replace(/\/+$/, '');
        this.client = axios.create({
            baseURL: this.host,
            timeout: 180000 // 3 minutos para inferencias locales pesadas
        });
    }

    public updateConfig(config: ExtensionConfig) {
        this.host = config.ollamaHost.replace(/\/+$/, '');
        this.client = axios.create({
            baseURL: this.host,
            timeout: 180000
        });
    }

    /**
     * Verifica la disponibilidad del servidor de Ollama
     */
    public async checkConnection(): Promise<boolean> {
        try {
            const response = await this.client.get('/api/tags');
            return response.status === 200;
        } catch {
            return false;
        }
    }

    private formatMessages(messages: ChatMessage[]): any[] {
        return messages.map(m => {
            const msgObj: any = {
                role: m.role,
                content: m.content
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
    private extractToolCallsFromContent(content: string): { toolCalls: any[]; remainingContent: string } {
        if (!content || !content.trim()) {
            return { toolCalls: [], remainingContent: content };
        }

        const toolCalls: any[] = [];
        let cleanContent = content;

        // Escanear objetos JSON balanceados { ... } en el texto
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
                        // No era un JSON válido, continuar escaneo
                    }
                    startIndex = -1;
                }
            }
        }

        // Si encontramos herramientas, limpiar los bloques de texto correspondientes
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
     * Llamada con streaming en tiempo real (token a token) y soporte para Tool Calling
     */
    public async chatStream(
        model: string,
        messages: ChatMessage[],
        tools: ToolDefinition[] | undefined,
        onToken: (token: string) => void
    ): Promise<{ message: ChatMessage; toolCalls?: any[] }> {
        try {
            const formattedMessages = this.formatMessages(messages);
            const payload: any = {
                model: model,
                messages: formattedMessages,
                stream: true,
                options: {
                    temperature: 0.2,
                    num_ctx: 16384, // Contexto balanceado para CPU sin sobrecargar RAM
                    num_thread: 12  // Aprovecha todos los hilos del Ryzen 7
                }
            };

            if (tools && tools.length > 0) {
                payload.tools = tools;
            }

            const response = await this.client.post('/api/chat', payload, {
                responseType: 'stream',
                timeout: 0 // FIX: Evita que Axios aborte con timeout en inferencias largas en CPU
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
                        } catch (e) {
                            // Ignorar fragmentos parciales
                        }
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
                        } catch { }
                    }

                    // Fallback robusto para herramientas devueltas como texto o JSON
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
                        toolCalls: toolCalls
                    });
                });

                response.data.on('error', (err: any) => {
                    reject(new Error(`[OllamaService.chatStream] Error en stream: ${err.message}`));
                });
            });
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Error al conectar con Ollama';
            throw new Error(`[OllamaService.chatStream] ${msg}`);
        }
    }

    /**
     * Llamada estándar al modelo principal de código con soporte para Tool Calling
     */
    public async chat(
        model: string,
        messages: ChatMessage[],
        tools?: ToolDefinition[]
    ): Promise<{ message: ChatMessage; toolCalls?: any[] }> {
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
                    content: content,
                    tool_calls: toolCalls
                },
                toolCalls: toolCalls
            };
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Error desconocido al conectar con Ollama';
            throw new Error(`[OllamaService.chat] ${msg}`);
        }
    }

    /**
     * Invocación con streaming de DeepSeek R1 para razonamiento profundo.
     * num_ctx=8192 es seguro para el modelo de 14B y evita desbordamiento de memoria.
     * num_gpu=0 por defecto ejecuta en CPU con 12 hilos, evitando el fallo de ROCm (error 500).
     */
    public async reasonStream(
        prompt: string,
        onToken: (token: string) => void,
        systemContext?: string,
        forcedCpuFallback: boolean = false,
        historyMessages: ChatMessage[] = []
    ): Promise<string> {
        try {
            const messages: any[] = [];
            if (systemContext) {
                messages.push({ role: 'system', content: systemContext });
            }

            // Inyectar historial previo (últimos 10 turnos) para mantener contexto conversacional
            if (historyMessages && historyMessages.length > 0) {
                const recentHistory = historyMessages
                    .filter(m => m.role !== 'system')
                    .slice(-10);
                for (const hMsg of recentHistory) {
                    messages.push({
                        role: hMsg.role,
                        content: hMsg.content
                    });
                }
            }

            messages.push({ role: 'user', content: prompt });

            const options: any = {
                temperature: 0.6,
                num_ctx: 8192,
                num_thread: 12
            };

            const useGpu = this.config.reasoningUseGpu === true && !forcedCpuFallback;
            if (!useGpu) {
                options.num_gpu = 0;
            }

            const response = await this.client.post('/api/chat', {
                model: this.config.reasoningModel,
                messages: messages,
                stream: true,
                options: options
            }, {
                responseType: 'stream',
                timeout: 0 // FIX: Evita timeout en razonamientos profundos en CPU
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
                        } catch { }
                    }
                });

                response.data.on('end', () => {
                    if (isThinking) {
                        fullContent += '\n</think>\n\n';
                    }
                    resolve(fullContent || 'No se recibió respuesta de razonamiento.');
                });

                response.data.on('error', (err: any) => {
                    reject(new Error(`[OllamaService.reasonStream] Error: ${err.message}`));
                });
            });
        } catch (error: any) {
            // Auto-recuperación: Si falló en GPU (error 500 por ROCm/OOM), reintentar automáticamente en CPU
            if (!forcedCpuFallback && (error.response?.status === 500 || error.message?.includes('500'))) {
                console.warn('[OllamaService.reasonStream] Error 500 en GPU/ROCm. Reintentando automáticamente en CPU...');
                return await this.reasonStream(prompt, onToken, systemContext, true, historyMessages);
            }
            const msg = error.response?.data?.error || error.message || 'Error en inferencia de razonamiento';
            throw new Error(`[OllamaService.reasonStream] ${msg}`);
        }
    }

    /**
     * Invocación estándar de DeepSeek R1.
     */
    public async reasonDeeply(
        prompt: string,
        systemContext?: string,
        forcedCpuFallback: boolean = false,
        historyMessages: ChatMessage[] = []
    ): Promise<string> {
        try {
            const messages: any[] = [];
            if (systemContext) {
                messages.push({
                    role: 'system',
                    content: systemContext
                });
            }

            if (historyMessages && historyMessages.length > 0) {
                const recentHistory = historyMessages
                    .filter(m => m.role !== 'system')
                    .slice(-10);
                for (const hMsg of recentHistory) {
                    messages.push({
                        role: hMsg.role,
                        content: hMsg.content
                    });
                }
            }

            messages.push({
                role: 'user',
                content: prompt
            });

            const options: any = {
                temperature: 0.6,
                num_ctx: 8192,
                num_thread: 12
            };

            const useGpu = this.config.reasoningUseGpu === true && !forcedCpuFallback;
            if (!useGpu) {
                options.num_gpu = 0;
            }

            const response = await this.client.post('/api/chat', {
                model: this.config.reasoningModel,
                messages: messages,
                stream: false,
                options: options
            });

            return response.data?.message?.content || 'No se recibió respuesta de razonamiento.';
        } catch (error: any) {
            if (!forcedCpuFallback && (error.response?.status === 500 || error.message?.includes('500'))) {
                console.warn('[OllamaService.reasonDeeply] Error 500 en GPU/ROCm. Reintentando automáticamente en CPU...');
                return await this.reasonDeeply(prompt, systemContext, true, historyMessages);
            }
            const msg = error.response?.data?.error || error.message || 'Error en inferencia de razonamiento';
            throw new Error(`[OllamaService.reasonDeeply] ${msg}`);
        }
    }

    /**
     * Invocación de Llama 3.2 Vision para análisis multimodal con imágenes en Base64
     */
    public async analyzeVision(prompt: string, base64Images: string[]): Promise<string> {
        try {
            const cleanImages = base64Images.map(img => {
                return img.replace(/^data:image\/[a-z]+;base64,/, '');
            });

            const response = await this.client.post('/api/chat', {
                model: this.config.visionModel,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                        images: cleanImages
                    }
                ],
                stream: false,
                options: {
                    temperature: 0.2
                }
            });

            return response.data?.message?.content || 'No se recibió análisis de la imagen.';
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Error en modelo de visión';
            throw new Error(`[OllamaService.analyzeVision] ${msg}`);
        }
    }

    /**
     * Generación de embeddings con nomic-embed-text:latest
     */
    public async generateEmbedding(text: string): Promise<number[]> {
        try {
            try {
                const embedResponse = await this.client.post('/api/embed', {
                    model: this.config.embeddingModel,
                    input: text
                });
                if (embedResponse.data?.embeddings && embedResponse.data.embeddings.length > 0) {
                    return embedResponse.data.embeddings[0];
                }
            } catch { }

            const response = await this.client.post('/api/embeddings', {
                model: this.config.embeddingModel,
                prompt: text
            });

            return response.data?.embedding || [];
        } catch (error: any) {
            const msg = error.response?.data?.error || error.message || 'Error al generar embeddings';
            throw new Error(`[OllamaService.generateEmbedding] ${msg}`);
        }
    }
}
