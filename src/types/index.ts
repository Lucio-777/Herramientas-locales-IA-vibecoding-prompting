export type ModelRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
    role: ModelRole;
    content: string;
    name?: string;
    tool_calls?: ToolCall[];
    images?: string[]; // Base64 encoded images
    original_content?: string; // Original user message before cloud/prompt enrichment
}

export interface ToolFunctionParameterProperty {
    type: string;
    description: string;
    enum?: string[];
    items?: {
        type: string;
        description?: string;
    };
}

export interface ToolFunctionParameters {
    type: 'object';
    properties: Record<string, ToolFunctionParameterProperty>;
    required?: string[];
}

export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: ToolFunctionParameters;
    };
}

export interface ToolCall {
    id?: string;
    type?: string;
    function: {
        name: string;
        arguments: Record<string, any> | string;
    };
}

export interface ToolExecutionResult {
    toolName: string;
    success: boolean;
    output: string;
    diff?: {
        filePath: string;
        oldContent: string;
        newContent: string;
    };
}

export type IntentType = 'VISION' | 'REASONING' | 'CODING_AGENT';

export interface RoutingDecision {
    intent: IntentType;
    targetModel: string;
    reason: string;
    enhancedSystemPrompt?: string;
    forceLocal?: boolean;
    isProviderStatusRequest?: boolean;
}

export interface RAGChunk {
    id: string;
    filePath: string;
    relativePath: string;
    startLine: number;
    endLine: number;
    content: string;
    embedding?: number[];
}

export interface RAGSearchResult {
    chunk: RAGChunk;
    similarity: number;
}

export interface ExecutionErrorRecord {
    toolName: string;
    args: string;
    error: string;
    timestamp: number;
}

export interface LoopRecoveryPlan {
    diagnosis: string;
    rootCause: string;
    recommendedActions: string[];
    revisedPromptForAgent: string;
}

export interface LSPDiagnostic {
    filePath: string;
    line: number;
    column: number;
    severity: 'Error' | 'Warning' | 'Information' | 'Hint';
    message: string;
    source: string;
}

export interface AtSuggestionItem {
    id: string;
    label: string;
    detail: string;
    type: 'file' | 'problems' | 'terminal' | 'git' | 'skill';
    insertText: string;
}

export interface ExtensionConfig {
    ollamaHost: string;
    codingModel: string;
    reasoningModel: string;
    visionModel: string;
    embeddingModel: string;
    cloudFilterEnabled: boolean;
    cloudApiUrl: string;
    cloudApiKey: string;
    cloudModel: string;
    maxToolRecursionDepth: number;
    ragTopK: number;
    enableStreaming: boolean;
    skillsPath?: string;
    maxActiveSkills?: number;
    enableAutoSkills?: boolean;
    skillsActivationMode?: 'on-demand' | 'always' | 'disabled';
    reasoningUseGpu?: boolean;
    lightweightModel?: string;
    enableHybridRouting?: boolean;
    enableContextPruning?: boolean;
    freellmApiUrl?: string;
    freellmApiKey?: string;
    freellmModel?: string;
}

// Mensajes bidireccionales entre Webview y Extensión
export type WebviewToExtensionMessage =
    | { type: 'ready' }
    | { type: 'sendMessage'; value: string; images?: string[] }
    | { type: 'clearChat' }
    | { type: 'indexWorkspace' }
    | { type: 'analyzeTerminal' }
    | { type: 'requestAtSuggestions'; query: string }
    | { type: 'openNativeDiff'; filePath: string; oldText: string; newText: string }
    | { type: 'cancelAgent' };

export type ToolBadgeStatus = 'running' | 'success' | 'error';

export type ExtensionToWebviewMessage =
    | { type: 'addMessage'; role: 'user' | 'agent' | 'system' | 'error'; content: string; model?: string; images?: string[] }
    | { type: 'streamStart'; role: 'agent'; model?: string }
    | { type: 'streamToken'; token: string }
    | { type: 'streamEnd'; content: string; toolCalls?: any[] }
    | { type: 'clearChat' }
    | { type: 'toolBadge'; toolName: string; status: ToolBadgeStatus; message: string; args?: any }
    | { type: 'diffPreview'; filePath: string; oldText: string; newText: string }
    | { type: 'atSuggestionsResponse'; items: AtSuggestionItem[] }
    | { type: 'agentStatus'; status: 'idle' | 'busy'; text?: string }
    | { type: 'ragStatus'; status: 'indexing' | 'ready' | 'error'; message: string };

// Tipos para el Patrón Supervisor Pro + Obreros FreeLLMAPI (Opción B)
export type RoutingStrategy = 'auto' | 'massive_context' | 'ultra_fast' | 'deep_reasoning';

export interface PendingProposal {
    id: string;
    filePath: string;
    originalContent: string;
    proposedContent: string;
    unifiedDiff: string;
    timestamp: number;
    status: 'pending' | 'approved' | 'rejected';
    metadata?: Record<string, any>;
}


