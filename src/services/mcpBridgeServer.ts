import * as http from 'http';
import * as vscode from 'vscode';
import { delegateToFreeLLMWorker, approveWorkerProposal, rejectWorkerProposal, WorkerStrategy } from '../tools/workerBridgeTools';
import { ToolExecutionResult } from '../types';

export const TOOL_DEFS = [
    {
        name: 'delegate_to_freellm_worker',
        description: 'Delegate a coding task to an external FreeLLM worker with a specific execution strategy.',
        inputSchema: {
            type: 'object',
            properties: {
                taskInstruction: {
                    type: 'string',
                    description: 'Instructions for the worker task.'
                },
                targetFile: {
                    type: 'string',
                    description: 'Path of the target file to be modified or created.'
                },
                referenceFiles: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Paths of reference files providing context.'
                },
                strategy: {
                    type: 'string',
                    enum: ['auto', 'massive_context', 'ultra_fast', 'deep_reasoning', 'local_only'],
                    description: 'Worker execution strategy.'
                }
            },
            required: ['taskInstruction', 'targetFile']
        }
    },
    {
        name: 'approve_worker_proposal',
        description: 'Approve a pending worker code proposal by proposal ID.',
        inputSchema: {
            type: 'object',
            properties: {
                proposalId: {
                    type: 'string',
                    description: 'Unique identifier of the worker proposal to approve.'
                }
            },
            required: ['proposalId']
        }
    },
    {
        name: 'reject_worker_proposal',
        description: 'Reject a pending worker code proposal with an optional explanation.',
        inputSchema: {
            type: 'object',
            properties: {
                proposalId: {
                    type: 'string',
                    description: 'Unique identifier of the worker proposal to reject.'
                },
                reason: {
                    type: 'string',
                    description: 'Reason for rejecting the proposal.'
                }
            },
            required: ['proposalId']
        }
    }
] as const;

interface JsonRpcRequest {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: unknown;
}

interface JsonRpcSuccessResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result: unknown;
}

interface JsonRpcErrorObject {
    code: number;
    message: string;
    data?: unknown;
}

interface JsonRpcErrorResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    error: JsonRpcErrorObject;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

function errMsg(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    return String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkerStrategy(val: unknown): val is WorkerStrategy {
    return val === 'auto' || val === 'massive_context' || val === 'ultra_fast' || val === 'deep_reasoning' || val === 'local_only';
}

export async function dispatchBridgeTool(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    switch (name) {
        case 'delegate_to_freellm_worker': {
            const taskInstruction = typeof args.taskInstruction === 'string' ? args.taskInstruction : undefined;
            const targetFile = typeof args.targetFile === 'string' ? args.targetFile : undefined;

            if (!taskInstruction || !targetFile) {
                return {
                    toolName: name,
                    success: false,
                    output: 'Missing required parameters: taskInstruction and targetFile must be strings.'
                };
            }

            let referenceFiles: string[] = [];
            if (Array.isArray(args.referenceFiles)) {
                referenceFiles = args.referenceFiles.filter((item): item is string => typeof item === 'string');
            }

            const strategy: WorkerStrategy = isWorkerStrategy(args.strategy) ? args.strategy : 'auto';

            return await delegateToFreeLLMWorker({
                taskInstruction,
                targetFile,
                referenceFiles,
                strategy
            });
        }
        case 'approve_worker_proposal': {
            const proposalId = typeof args.proposalId === 'string' ? args.proposalId : undefined;
            if (!proposalId) {
                return {
                    toolName: name,
                    success: false,
                    output: 'Missing required parameter: proposalId must be a string.'
                };
            }
            return await approveWorkerProposal({ proposalId });
        }
        case 'reject_worker_proposal': {
            const proposalId = typeof args.proposalId === 'string' ? args.proposalId : undefined;
            if (!proposalId) {
                return {
                    toolName: name,
                    success: false,
                    output: 'Missing required parameter: proposalId must be a string.'
                };
            }
            const reason = typeof args.reason === 'string' ? args.reason : undefined;
            return await rejectWorkerProposal({ proposalId, reason });
        }
        default:
            return {
                toolName: name,
                success: false,
                output: `Unknown tool: ${name}`
            };
    }
}

export class McpBridgeServer implements vscode.Disposable {
    private server: http.Server | null = null;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly sseClients: Set<http.ServerResponse> = new Set();
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private isDisposed = false;

    constructor(
        private readonly port = 3002,
        private readonly host = '127.0.0.1'
    ) {
        this.outputChannel = vscode.window.createOutputChannel('VibeCoding MCP Bridge');
    }

    public async start(): Promise<void> {
        return new Promise<void>((resolve) => {
            const server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch((err: unknown) => {
                    this.outputChannel.appendLine(`[${new Date().toISOString()}] Unhandled request error: ${errMsg(err)}`);
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Internal Server Error' }));
                    }
                });
            });

            server.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'EADDRINUSE') {
                    this.outputChannel.appendLine(
                        `[${new Date().toISOString()}] [MCP Bridge] Puerto ${this.port} ya activo por el daemon global, reutilizando instancia.`
                    );
                    resolve();
                } else {
                    this.outputChannel.appendLine(`[${new Date().toISOString()}] Server error: ${errMsg(err)}`);
                    resolve();
                }
            });

            this.server = server;

            server.listen(this.port, this.host, () => {
                this.outputChannel.appendLine(
                    `[${new Date().toISOString()}] MCP Bridge listening on http://${this.host}:${this.port}`
                );
                this.startHeartbeat();
                resolve();
            });
        });
    }

    public dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.isDisposed = true;

        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        for (const client of this.sseClients) {
            try {
                client.end();
            } catch {
                // Ignore errors on closing client streams
            }
        }
        this.sseClients.clear();

        if (this.server) {
            this.server.close();
            this.server = null;
        }

        this.outputChannel.dispose();
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = setInterval(() => {
            for (const client of this.sseClients) {
                try {
                    client.write(': ping\n\n');
                } catch {
                    this.sseClients.delete(client);
                }
            }
        }, 25000);
    }

    private isValidHost(hostHeader: string | undefined): boolean {
        if (!hostHeader) {
            return false;
        }
        const expectedIpHost = `${this.host}:${this.port}`;
        const expectedNamedHost = `localhost:${this.port}`;
        return hostHeader === expectedIpHost || hostHeader === expectedNamedHost;
    }

    private getCorsOrigin(req: http.IncomingMessage): string | null {
        const origin = req.headers.origin;
        if (typeof origin !== 'string') {
            return null;
        }
        if (
            origin.startsWith('http://127.0.0.1') ||
            origin.startsWith('http://localhost') ||
            origin.startsWith('vscode-webview://')
        ) {
            return origin;
        }
        return null;
    }

    private applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
        const allowedOrigin = this.getCorsOrigin(req);
        if (allowedOrigin) {
            res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        }
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (!this.isValidHost(req.headers.host)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden: Invalid Host header' }));
            return;
        }

        this.applyCors(req, res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const urlPath = (req.url ?? '').split('?')[0];

        if (req.method === 'GET' && urlPath === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'ok',
                server: 'vibecoding-mcp-bridge',
                port: this.port
            }));
            return;
        }

        const accept = req.headers.accept ?? '';
        const isSsePath = urlPath === '/mcp/sse' || (urlPath === '/mcp' && accept.includes('text/event-stream'));

        if (req.method === 'GET' && isSsePath) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            res.write('event: endpoint\ndata: /mcp\n\n');

            this.sseClients.add(res);

            req.on('close', () => {
                this.sseClients.delete(res);
            });
            return;
        }

        if (req.method === 'POST' && urlPath === '/mcp') {
            await this.handlePostMcp(req, res);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    }

    private async handlePostMcp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        let rawBody: string;
        try {
            rawBody = await this.readBody(req, 5 * 1024 * 1024);
        } catch (err: unknown) {
            const message = errMsg(err);
            if (message === 'Payload Too Large') {
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32000, message: 'Payload Too Large' }
                }));
                return;
            }
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' }
            }));
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(rawBody);
        } catch {
            const errorResponse: JsonRpcErrorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'Parse error' }
            };
            this.sendJsonRpcResponse(res, errorResponse, 200);
            return;
        }

        if (Array.isArray(parsed)) {
            if (parsed.length === 0) {
                const errorResponse: JsonRpcErrorResponse = {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32600, message: 'Invalid Request: empty batch' }
                };
                this.sendJsonRpcResponse(res, errorResponse, 200);
                return;
            }

            const responses: JsonRpcResponse[] = [];
            for (const item of parsed) {
                const response = await this.processRpcItem(item);
                if (response !== null) {
                    responses.push(response);
                }
            }

            if (responses.length === 0) {
                res.writeHead(202);
                res.end();
            } else {
                this.sendJsonRpcResponse(res, responses, 200);
            }
            return;
        }

        if (isRecord(parsed)) {
            const response = await this.processRpcItem(parsed);
            if (response === null) {
                res.writeHead(202);
                res.end();
            } else {
                this.sendJsonRpcResponse(res, response, 200);
            }
            return;
        }

        const errorResponse: JsonRpcErrorResponse = {
            jsonrpc: '2.0',
            id: null,
            error: { code: -32600, message: 'Invalid Request' }
        };
        this.sendJsonRpcResponse(res, errorResponse, 200);
    }

    private async processRpcItem(item: unknown): Promise<JsonRpcResponse | null> {
        if (!isRecord(item)) {
            return {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32600, message: 'Invalid Request' }
            };
        }

        const id = (typeof item.id === 'string' || typeof item.id === 'number' || item.id === null)
            ? item.id
            : undefined;
        const isNotification = id === undefined;

        if (item.jsonrpc !== '2.0' || typeof item.method !== 'string') {
            if (isNotification) {
                return null;
            }
            return {
                jsonrpc: '2.0',
                id: id ?? null,
                error: { code: -32600, message: 'Invalid Request' }
            };
        }

        const method = item.method;
        const params = item.params;

        try {
            return await this.executeRpcMethod(method, params, id, isNotification);
        } catch (err: unknown) {
            if (isNotification) {
                return null;
            }
            return {
                jsonrpc: '2.0',
                id: id ?? null,
                error: { code: -32603, message: `Internal error: ${errMsg(err)}` }
            };
        }
    }

    private async executeRpcMethod(
        method: string,
        params: unknown,
        id: string | number | null | undefined,
        isNotification: boolean
    ): Promise<JsonRpcResponse | null> {
        switch (method) {
            case 'initialize': {
                if (isNotification) {
                    return null;
                }
                return {
                    jsonrpc: '2.0',
                    id: id ?? null,
                    result: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {
                                listChanged: false
                            }
                        },
                        serverInfo: {
                            name: 'vibecoding-mcp-bridge',
                            version: '0.3.0'
                        }
                    }
                };
            }
            case 'notifications/initialized': {
                return null;
            }
            case 'ping': {
                if (isNotification) {
                    return null;
                }
                return {
                    jsonrpc: '2.0',
                    id: id ?? null,
                    result: {}
                };
            }
            case 'tools/list': {
                if (isNotification) {
                    return null;
                }
                return {
                    jsonrpc: '2.0',
                    id: id ?? null,
                    result: {
                        tools: TOOL_DEFS
                    }
                };
            }
            case 'tools/call': {
                if (!isRecord(params) || typeof params.name !== 'string') {
                    if (isNotification) {
                        return null;
                    }
                    return {
                        jsonrpc: '2.0',
                        id: id ?? null,
                        error: { code: -32602, message: 'Invalid params: name required' }
                    };
                }

                const toolName = params.name;
                const toolArgs = isRecord(params.arguments) ? params.arguments : {};
                const executionResult = await dispatchBridgeTool(toolName, toolArgs);

                const timestamp = new Date().toISOString();
                this.outputChannel.appendLine(
                    `[${timestamp}] tools/call name="${toolName}" success=${executionResult.success}`
                );

                if (isNotification) {
                    return null;
                }

                return {
                    jsonrpc: '2.0',
                    id: id ?? null,
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
            default: {
                if (isNotification) {
                    return null;
                }
                return {
                    jsonrpc: '2.0',
                    id: id ?? null,
                    error: {
                        code: -32601,
                        message: `Method not found: ${method}`
                    }
                };
            }
        }
    }

    private sendJsonRpcResponse(res: http.ServerResponse, body: JsonRpcResponse | JsonRpcResponse[], statusCode: number): void {
        const payload = JSON.stringify(body);
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(payload);

        this.broadcastToSse(payload);
    }

    private broadcastToSse(jsonPayload: string): void {
        const message = `event: message\ndata: ${jsonPayload}\n\n`;
        for (const client of this.sseClients) {
            try {
                client.write(message);
            } catch {
                this.sseClients.delete(client);
            }
        }
    }

    private readBody(req: http.IncomingMessage, limitBytes: number): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            let totalBytes = 0;
            const chunks: Buffer[] = [];

            req.on('data', (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes > limitBytes) {
                    req.destroy();
                    reject(new Error('Payload Too Large'));
                    return;
                }
                chunks.push(chunk);
            });

            req.on('end', () => {
                resolve(Buffer.concat(chunks).toString('utf-8'));
            });

            req.on('error', (err: unknown) => {
                reject(err);
            });
        });
    }
}