// Intercepción temprana de stdout: En modo STDIO MCP, STDOUT está reservado exclusivamente
// para tramas JSON-RPC 2.0. Cualquier console.log contaminaría el stream y rompería clientes MCP.
if (process.argv.includes('--stdio')) {
    const toStderr = (...args: any[]) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        process.stderr.write(msg + '\n');
    };
    console.log = toStderr;
    console.info = toStderr;
    console.warn = toStderr;
    console.debug = toStderr;
}

// Shim de compatibilidad cuando se ejecuta desacoplado fuera de VS Code (ej. demonio CLI o modo --stdio)
try {
    require('vscode');
} catch {
    const Module = require('module');
    const origRequire = Module.prototype.require;
    Module.prototype.require = function (id: string) {
        if (id === 'vscode') {
            return {
                workspace: {
                    workspaceFolders: [{ uri: { fsPath: process.cwd() } }],
                    getConfiguration: () => ({
                        get: (_key: string, defaultValue?: any) => defaultValue
                    }),
                    registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
                    openTextDocument: async (uri: any) => ({ uri, getText: () => '' })
                },
                window: {
                    showInformationMessage: (msg: string) => console.warn('[Info]', msg),
                    showWarningMessage: (msg: string) => console.warn('[Warn]', msg),
                    showErrorMessage: (msg: string) => console.error('[Error]', msg),
                    activeTextEditor: undefined,
                    terminals: [],
                    createOutputChannel: () => ({
                        appendLine: () => {},
                        append: () => {},
                        clear: () => {},
                        show: () => {},
                        dispose: () => {}
                    })
                },
                languages: {
                    getDiagnostics: (_uri?: any) => []
                },
                DiagnosticSeverity: {
                    Error: 0,
                    Warning: 1,
                    Information: 2,
                    Hint: 3
                },
                env: {
                    clipboard: {
                        readText: async () => '',
                        writeText: async () => {}
                    }
                },
                Uri: {
                    parse: (str: string) => ({ toString: () => str, fsPath: str }),
                    file: (str: string) => ({ fsPath: str, toString: () => str })
                },
                EventEmitter: class {
                    event = () => {};
                    fire = () => {};
                },
                commands: {
                    executeCommand: async () => {}
                }
            };
        }
        return origRequire.apply(this, arguments);
    };
}
import * as http from 'http';
import * as readline from 'readline';
import { executeToolCall, AGENT_TOOLS } from '../tools';
import { OllamaService } from '../services/ollamaService';
import { ExtensionConfig } from '../types';

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id?: string | number | null;
    method: string;
    params?: any;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export class McpBridgeServer {
    private static instance: McpBridgeServer;
    private httpServer?: http.Server;
    private ollamaService: OllamaService;
    private isStdioRunning = false;

    private constructor() {
        const dummyConfig: ExtensionConfig = {
            ollamaHost: 'http://127.0.0.1:11434',
            codingModel: 'qwen2.5-coder:7b',
            reasoningModel: 'deepseek-r1:1.5b',
            visionModel: 'llama3.2-vision:11b',
            embeddingModel: 'nomic-embed-text',
            cloudFilterEnabled: false,
            cloudApiUrl: 'http://127.0.0.1:3001/v1',
            cloudApiKey: '',
            cloudModel: 'auto',
            maxToolRecursionDepth: 10,
            ragTopK: 4,
            enableStreaming: false
        };
        this.ollamaService = new OllamaService(dummyConfig);
    }

    public static getInstance(): McpBridgeServer {
        if (!McpBridgeServer.instance) {
            McpBridgeServer.instance = new McpBridgeServer();
        }
        return McpBridgeServer.instance;
    }

    public async handleJsonRpc(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
        // En JSON-RPC 2.0, una notificación carece de 'id' (es undefined).
        // Por especificación estricta de JSON-RPC 2.0 y MCP, el servidor NUNCA debe responder a notificaciones.
        const isNotification = req.id === undefined;
        const id = req.id !== undefined ? req.id : null;

        if (isNotification || req.method?.startsWith('notifications/')) {
            return null;
        }

        switch (req.method) {
            case 'initialize':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: { listChanged: false },
                            resources: { listChanged: false },
                            prompts: { listChanged: false }
                        },
                        serverInfo: {
                            name: 'vibecoding-mcp-bridge',
                            version: '0.3.0'
                        }
                    }
                };

            case 'ping':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {}
                };

            case 'tools/list': {
                const mcpTools = AGENT_TOOLS.map(t => ({
                    name: t.function.name,
                    description: t.function.description,
                    inputSchema: t.function.parameters
                }));
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { tools: mcpTools }
                };
            }

            case 'resources/list':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { resources: [] }
                };

            case 'resources/templates/list':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { resourceTemplates: [] }
                };

            case 'prompts/list':
                return {
                    jsonrpc: '2.0',
                    id,
                    result: { prompts: [] }
                };

            case 'tools/call': {
                const toolName = req.params?.name;
                const toolArgs = req.params?.arguments || {};

                if (!toolName) {
                    return {
                        jsonrpc: '2.0',
                        id,
                        error: { code: -32602, message: 'Invalid params: name is required.' }
                    };
                }

                const executionResult = await executeToolCall(toolName, toolArgs, this.ollamaService);
                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: executionResult.output
                            }
                        ],
                        isError: !executionResult.success
                    }
                };
            }

            default:
                return {
                    jsonrpc: '2.0',
                    id,
                    error: { code: -32601, message: `Method '${req.method}' not found.` }
                };
        }
    }

    /**
     * Inicia el servidor HTTP JSON-RPC en el puerto 3002 para Visual Studio (C#) y clientes locales
     */
    public startHttpServer(port: number = 3002): http.Server {
        if (this.httpServer) {
            return this.httpServer;
        }

        this.httpServer = http.createServer(async (req, res) => {
            // Habilitar CORS para clientes multi-IDE
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', name: 'vibecoding-mcp-bridge', port }));
                return;
            }

            if (req.method === 'POST') {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', async () => {
                    try {
                        const json = JSON.parse(body);
                        const response = await this.handleJsonRpc(json);
                        if (response) {
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(response));
                        } else {
                            res.writeHead(204);
                            res.end();
                        }
                    } catch (err: any) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id: null,
                            error: { code: -32700, message: 'Parse error: ' + err.message }
                        }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end();
        });

        this.httpServer.listen(port, '127.0.0.1', () => {
            console.log(`[VibeCoding MCP Bridge] HTTP daemon escuchando en http://127.0.0.1:${port}/mcp`);
        });

        this.httpServer.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`[MCP Bridge] Puerto ${port} ya activo por el daemon global, reutilizando instancia.`);
            } else {
                console.error('[VibeCoding MCP Bridge] Error en servidor HTTP:', err);
            }
        });

        return this.httpServer;
    }

    /**
     * Inicia transporte Stdio para integración nativa con clientes MCP
     */
    public startStdioServer(): void {
        if (this.isStdioRunning) {
            return;
        }
        this.isStdioRunning = true;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });

        rl.on('line', async line => {
            const trimmed = line.trim();
            if (!trimmed) {
                return;
            }
            try {
                const request = JSON.parse(trimmed) as JsonRpcRequest;
                const response = await this.handleJsonRpc(request);
                if (response) {
                    process.stdout.write(JSON.stringify(response) + '\n');
                }
            } catch (err: any) {
                const errResp: JsonRpcResponse = {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error: ' + err.message }
                };
                process.stdout.write(JSON.stringify(errResp) + '\n');
            }
        });
    }

    public stopHttpServer(): void {
        if (this.httpServer) {
            this.httpServer.close();
            this.httpServer = undefined;
        }
    }
}

export function startMcpDaemon(port: number = 3002): http.Server {
    return McpBridgeServer.getInstance().startHttpServer(port);
}

export function stopMcpDaemon(): void {
    McpBridgeServer.getInstance().stopHttpServer();
}

// Soporte de ejecución directa por Node (ej. node out/server/mcpBridge.js --stdio o --port 3002)
if (require.main === module) {
    const isStdio = process.argv.includes('--stdio');
    if (isStdio) {
        McpBridgeServer.getInstance().startStdioServer();
    } else {
        const portIdx = process.argv.indexOf('--port');
        const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1], 10) : 3002;
        McpBridgeServer.getInstance().startHttpServer(port);
    }
}
