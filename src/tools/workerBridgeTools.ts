import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ToolExecutionResult } from '../types';

export type WorkerStrategy = 'auto' | 'massive_context' | 'ultra_fast' | 'deep_reasoning' | 'local_only';

export interface SmartRoute {
    primaryModel: string;
    fallbackModel?: string;
    reason: string;
}

export function resolveSmartModel(
    strategy: WorkerStrategy | undefined,
    totalChars: number,
    totalLines: number,
    taskInstruction: string
): SmartRoute {
    // 1. Si el Jefe especificó una estrategia explícita, respetarla directamente
    if (strategy && strategy !== 'auto') {
        switch (strategy) {
            case 'ultra_fast':
                return { primaryModel: 'gpt-oss-120b', fallbackModel: 'auto', reason: 'Estrategia explícita: ultra_fast (Cerebras/Groq)' };
            case 'massive_context':
                return { primaryModel: 'gemini-flash-latest', fallbackModel: 'auto', reason: 'Estrategia explícita: massive_context (Gemini Flash / Cohere)' };
            case 'deep_reasoning':
                return { primaryModel: 'qwen2.5-coder-32b', fallbackModel: 'auto', reason: 'Estrategia explícita: deep_reasoning (DeepSeek R1 / Qwen 32B)' };
            case 'local_only':
                return { primaryModel: 'local_only', reason: 'Estrategia explícita: local_only (Ollama 100% offline)' };
        }
    }

    // 2. Si strategy es 'auto' (o no se especificó), aplicar Fastest-First Auto-Tuning:
    // a) Detección de Contexto Masivo (> 45,000 chars)
    if (totalChars > 45000) {
        return {
            primaryModel: 'gemini-flash-latest',
            fallbackModel: 'auto',
            reason: `Massive Context (${totalChars} chars, ${totalLines} líneas > 45k) -> Priorizando Gemini Flash Latest`
        };
    }

    // b) Detección de Razonamiento Profundo (palabras clave de complejidad técnica)
    const complexRegex = /(\bbug\b|race condition|deadlock|algoritm|arquitectura|refactorizar|vulnerabilidad)/i;
    if (complexRegex.test(taskInstruction)) {
        return {
            primaryModel: 'qwen2.5-coder-32b',
            fallbackModel: 'auto',
            reason: `Deep Reasoning (complejidad/arquitectura detectada) -> Priorizando 32B Reasoning`
        };
    }

    // c) Prioridad Ultra-Rápida por Defecto (Fastest-First) para tareas cotidianas y archivos ligeros/medianos
    return {
        primaryModel: 'gpt-oss-120b',
        fallbackModel: 'auto',
        reason: `Fastest-First (${totalChars} chars, ${totalLines} líneas <= 45k) -> Priorizando Cerebras/Groq (<2s)`
    };
}

interface StagedProposal {
    proposalId: string;
    targetFile: string;
    absolutePath: string;
    originalContent: string;
    proposedContent: string;
    diff: string;
    modelUsed: string;
    createdAt: number;
}

const stagedProposals = new Map<string, StagedProposal>();

export function listStagedProposals(): StagedProposal[] {
    return Array.from(stagedProposals.values());
}

function getConfiguration<T>(key: string, defaultValue: T): T {
    const config = vscode.workspace.getConfiguration('vibe-coding-local');
    return config.get<T>(key, defaultValue);
}

function resolvePath(p: string): string {
    // Si la ruta ya es absoluta (ej. invocación desde un proyecto externo o ruta completa del IDE), permitirla normalizada
    if (path.isAbsolute(p)) {
        return path.normalize(p);
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const baseDir = path.resolve(
        workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd()
    );
    const resolved = path.resolve(baseDir, p);
    const rel = path.relative(baseDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`Path traversal detected: ruta relativa '${p}' intenta escapar del workspace activo (${resolved})`);
    }
    return resolved;
}

async function readReferenceFiles(files: string[]): Promise<string> {
    let output = '';
    for (const file of files) {
        try {
            const absPath = resolvePath(file);
            let content = fs.readFileSync(absPath, 'utf-8');
            if (content.length > 60000) {
                content = content.substring(0, 60000);
            }
            output += `### FILE: ${file}\n${content}\n\n`;
        } catch (err) {
            output += `### FILE: ${file} [MISSING]\n\n`;
        }
    }
    return output;
}

async function isFreeLLMReachable(baseUrl: string): Promise<boolean> {
    try {
        const healthUrl = baseUrl.replace(/\/v1\/?$/, '') + '/health';
        const res = await fetch(healthUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(1500)
        });
        return res.ok || res.status < 500;
    } catch {
        return false;
    }
}

async function callFreeLLM(
    model: string,
    system: string,
    user: string,
    timeoutMs = 25000
): Promise<{ content: string; model: string }> {
    const baseUrl = getConfiguration<string>('freellmApiUrl', 'http://127.0.0.1:3001/v1');
    const reachable = await isFreeLLMReachable(baseUrl);
    if (!reachable) {
        throw new Error(`FreeLLM server unreachable at ${baseUrl} (fast health check failed)`);
    }

    const apiKey = getConfiguration<string>('freellmApiKey', '') || process.env.FREELLM_API_KEY || 'freellmapi-86a31ceb7d1a23a23a9d761e0d2c92dfc9efb25675381691';
    const url = `${baseUrl}/chat/completions`;

    const body = {
        model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        temperature: 0.1,
        stream: false
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`FreeLLM API error (${response.status}): ${errText || response.statusText}`);
    }

    const data = await response.json() as unknown;
    if (typeof data === 'object' && data !== null && 'choices' in data) {
        const typed = data as { model?: string; choices: Array<{ message?: { content?: string } }> };
        const content = typed.choices[0]?.message?.content ?? '';
        if (!content.trim()) {
            throw new Error('Empty completion from FreeLLM');
        }
        return { content, model: typed.model ?? model };
    }
    throw new Error('Invalid response format from FreeLLM');
}
async function callOllama(system: string, user: string): Promise<{ content: string; model: string }> {
    const ollamaHost = getConfiguration<string>('ollamaHost', 'http://127.0.0.1:11434');
    const url = `${ollamaHost}/api/chat`;

    const body = {
        model: 'qwen2.5-coder:7b',
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
        ],
        stream: false,
        options: {
            num_ctx: 4096
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180000)
    });

    if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as unknown;
    if (typeof data === 'object' && data !== null && 'message' in data) {
        const content = (data as { message: { content: string } }).message.content;
        return { content, model: 'qwen2.5-coder:7b' };
    }
    throw new Error('Invalid response format from Ollama');
}

function extractCode(raw: string): string {
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    const regex = /```([\w.+-]+)?[ \t]*\r?\n([\s\S]*?)```/g;
    let match;
    let largestBlock = '';
    let largestLength = 0;

    while ((match = regex.exec(raw)) !== null) {
        const content = match[2];
        if (content.length > largestLength) {
            largestLength = content.length;
            largestBlock = content;
        }
    }

    if (largestBlock) {
        return largestBlock;
    }
    return raw.trim();
}

export function generateCompactDiff(oldText: string, newText: string, context = 2): string {
    const a = oldText.replace(/\r\n/g, '\n').split('\n');
    const b = newText.replace(/\r\n/g, '\n').split('\n');

    // Recorte de prefijo/sufijo comÃºn: reduce el LCS a la zona realmente modificada
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) { pre++; }
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) { suf++; }
    if (pre === a.length && pre === b.length) { return '(sin cambios)'; }

    const am = a.slice(pre, a.length - suf);
    const bm = b.slice(pre, b.length - suf);
    type Op = { t: ' ' | '-' | '+'; line: string; ai: number; bi: number };
    const ops: Op[] = [];
    for (let k = 0; k < pre; k++) { ops.push({ t: ' ', line: a[k], ai: k, bi: k }); }

    const m = am.length;
    const n = bm.length;
    if (m * n <= 4_000_000) {
        const w = n + 1;
        const dp = new Uint32Array((m + 1) * w);
        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                dp[i * w + j] = am[i] === bm[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
            }
        }
        let i = 0;
        let j = 0;
        while (i < m || j < n) {
            if (i < m && j < n && am[i] === bm[j]) { ops.push({ t: ' ', line: am[i], ai: pre + i, bi: pre + j }); i++; j++; }
            else if (i < m && (j >= n || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) { ops.push({ t: '-', line: am[i], ai: pre + i, bi: pre + j }); i++; }
            else { ops.push({ t: '+', line: bm[j], ai: pre + i, bi: pre + j }); j++; }
        }
    } else {
        // Fallback para archivos enormes: bloque central como reemplazo completo
        am.forEach((line, k) => ops.push({ t: '-', line, ai: pre + k, bi: pre }));
        bm.forEach((line, k) => ops.push({ t: '+', line, ai: pre + m, bi: pre + k }));
    }
    for (let k = 0; k < suf; k++) {
        ops.push({ t: ' ', line: a[a.length - suf + k], ai: a.length - suf + k, bi: b.length - suf + k });
    }

    // Agrupar en hunks con `context` lÃ­neas de contexto
    const out: string[] = [];
    let k = 0;
    while (k < ops.length) {
        if (ops[k].t === ' ') { k++; continue; }
        const start = Math.max(0, k - context);
        let end = k;
        let lastChange = k;
        while (end < ops.length && (ops[end].t !== ' ' || end - lastChange <= context * 2)) {
            if (ops[end].t !== ' ') { lastChange = end; }
            end++;
        }
        end = Math.min(ops.length, lastChange + context + 1);
        const slice = ops.slice(start, end);
        const oldCount = slice.filter(o => o.t !== '+').length;
        const newCount = slice.filter(o => o.t !== '-').length;
        out.push(`@@ -${slice[0].ai + 1},${oldCount} +${slice[0].bi + 1},${newCount} @@`);
        for (const o of slice) { out.push(o.t + o.line); }
        k = end;
    }
    return out.length ? out.join('\n') : '(sin cambios)';
}

function errMsg(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    return String(e);
}

export async function delegateToFreeLLMWorker(args: {
    taskInstruction: string;
    targetFile: string;
    referenceFiles?: string[];
    strategy?: WorkerStrategy;
}): Promise<ToolExecutionResult> {
    const { taskInstruction, targetFile, referenceFiles = [], strategy = 'auto' } = args;

    if (!taskInstruction || !targetFile) {
        return {
            toolName: 'delegate_to_freellm_worker',
            success: false,
            output: JSON.stringify({ error: 'Missing taskInstruction or targetFile' }, null, 2)
        };
    }

    try {
        const absPath = resolvePath(targetFile);
        let currentContent = '';
        try {
            currentContent = fs.readFileSync(absPath, 'utf-8');
        } catch {
            currentContent = '';
        }

        const references = await readReferenceFiles(referenceFiles);

        const systemPrompt = `You are a coding assistant. The user wants to modify a file. Return ONLY the COMPLETE final content of the file in a single fenced code block (e.g., \`\`\`javascript). Do not include explanations, markdown, or conversational filler.`;
        const userPrompt = `${taskInstruction}\n\nCurrent file content:\n\`\`\`\n${currentContent}\n\`\`\`\n\nReferences:\n${references}`;

        const totalChars = currentContent.length + references.length;
        const totalLines = currentContent.split('\n').length;
        const smartRoute = resolveSmartModel(strategy, totalChars, totalLines, taskInstruction);

        let modelUsed = '';
        let finalContent = '';
        const startInfer = Date.now();

        if (smartRoute.primaryModel === 'local_only') {
            try {
                const result = await callOllama(systemPrompt, userPrompt);
                finalContent = result.content;
                modelUsed = result.model;
            } catch (e) {
                return {
                    toolName: 'delegate_to_freellm_worker',
                    success: false,
                    output: JSON.stringify({ error: 'Ollama failed', details: errMsg(e) }, null, 2)
                };
            }
        } else {
            // Intentar modelo primario (ej. gpt-oss-120b Fastest-First) con micro-timeout de 15s si es rápido
            const isFastAttempt = smartRoute.primaryModel === 'gpt-oss-120b';
            try {
                const result = await callFreeLLM(
                    smartRoute.primaryModel,
                    systemPrompt,
                    userPrompt,
                    isFastAttempt ? 15000 : 25000
                );
                finalContent = result.content;
                modelUsed = result.model;
            } catch (primaryErr) {
                // Failover transparente instantáneo: micro-retry con model: "auto" en FreeLLMAPI
                // Si el servidor FreeLLM ni siquiera está alcanzable, no hacer segundo intento inútil
                const isUnreachable = errMsg(primaryErr).includes('unreachable');
                let fallbackApiErr: unknown = null;
                if (!isUnreachable && smartRoute.fallbackModel && smartRoute.fallbackModel !== smartRoute.primaryModel) {
                    try {
                        const fallbackResult = await callFreeLLM(
                            smartRoute.fallbackModel,
                            systemPrompt,
                            userPrompt,
                            25000
                        );
                        finalContent = fallbackResult.content;
                        modelUsed = fallbackResult.model;
                    } catch (fbErr) {
                        fallbackApiErr = fbErr;
                    }
                }
                // Si ambos intentos en FreeLLMAPI fallaron y strategy !== 'local_only', NO caer a Ollama:
                // El Agente Pro debe tomar el control inmediato (Nivel 3).
                if (!finalContent) {
                    return {
                        toolName: 'delegate_to_freellm_worker',
                        success: false,
                        output: JSON.stringify({
                            status: 'CLOUD_WORKERS_EXHAUSTED_PRO_TAKEOVER',
                            targetFile: absPath,
                            actionRequired: 'Todos los proveedores gratuitos en la nube están en Cooldown o sin conexión. Como Agente Pro (Nivel 3), toma el control inmediatamente y realiza la edición del archivo tú mismo sin delegar a Ollama.',
                            autoRoutingReason: smartRoute.reason,
                            latencyMs: Date.now() - startInfer,
                            primaryError: errMsg(primaryErr),
                            fallbackApiError: fallbackApiErr ? errMsg(fallbackApiErr) : 'No fallback model defined'
                        }, null, 2)
                    };
                }
            }
        }

        const latencyMs = Date.now() - startInfer;

        const extractedCode = extractCode(finalContent);
        const diff = generateCompactDiff(currentContent, extractedCode);
        const proposalId = `wp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

        const isNewFile = currentContent === '';
        const linesBefore = currentContent.split('\n').length;
        const linesAfter = extractedCode.split('\n').length;
        const diffToAudit = diff;

        const proposal: StagedProposal = {
            proposalId,
            targetFile,
            absolutePath: absPath,
            originalContent: currentContent,
            proposedContent: extractedCode,
            diff,
            modelUsed,
            createdAt: Date.now()
        };

        stagedProposals.set(proposalId, proposal);

        return {
            toolName: 'delegate_to_freellm_worker',
            success: true,
            output: JSON.stringify({
                proposalId,
                targetFile: absPath,
                modelUsed,
                autoRoutingReason: smartRoute.reason,
                latencyMs,
                isNewFile,
                linesBefore,
                linesAfter,
                diffToAudit
            }, null, 2)
        };
    } catch (e) {
        return {
            toolName: 'delegate_to_freellm_worker',
            success: false,
            output: JSON.stringify({ error: errMsg(e) }, null, 2)
        };
    }
}

export async function approveWorkerProposal(args: { proposalId: string }): Promise<ToolExecutionResult> {
    const { proposalId } = args;

    const proposal = stagedProposals.get(proposalId);
    if (!proposal) {
        return {
            toolName: 'approve_worker_proposal',
            success: false,
            output: JSON.stringify({ proposalId, error: 'Proposal not found' }, null, 2)
        };
    }

    try {
        const dir = path.dirname(proposal.absolutePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(proposal.absolutePath, proposal.proposedContent, 'utf-8');
        stagedProposals.delete(proposalId);

        try {
            await vscode.workspace.openTextDocument(vscode.Uri.file(proposal.absolutePath));
            await new Promise(resolve => setTimeout(resolve, 800));
        } catch (openErr) {
            // Ignore errors opening doc
        }

        const diagnostics = vscode.languages.getDiagnostics(vscode.Uri.file(proposal.absolutePath));
        const errorDiagnostics = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        const warningDiagnostics = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);

        const formattedDiagnostics = [
            ...errorDiagnostics.map(d => `[Error] L${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message} (${d.source})`),
            ...warningDiagnostics.map(d => `[Warning] L${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message} (${d.source})`)
        ].slice(0, 30);

        return {
            toolName: 'approve_worker_proposal',
            success: true,
            output: JSON.stringify({ proposalId, written: proposal.absolutePath, errors: errorDiagnostics.length, warnings: warningDiagnostics.length, diagnostics: formattedDiagnostics }, null, 2)
        };
    } catch (e) {
        return {
            toolName: 'approve_worker_proposal',
            success: false,
            output: JSON.stringify({ proposalId, error: errMsg(e) }, null, 2)
        };
    }
}

export async function rejectWorkerProposal(args: { proposalId: string; reason?: string }): Promise<ToolExecutionResult> {
    const { proposalId, reason } = args;

    const existed = stagedProposals.delete(proposalId);

    return {
        toolName: 'reject_worker_proposal',
        success: existed,
        output: JSON.stringify({ proposalId, rejected: existed, reason }, null, 2)
    };
}
