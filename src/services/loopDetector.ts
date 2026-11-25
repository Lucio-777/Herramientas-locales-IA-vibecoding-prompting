import { ExecutionErrorRecord, LoopRecoveryPlan, ToolExecutionResult } from '../types';
import { OllamaService } from './ollamaService';

export class LoopDetector {
    private errorHistory: ExecutionErrorRecord[] = [];
    private executedSignatures: Set<string> = new Set();
    private failedSignatures: Map<string, number> = new Map();
    private consecutiveFailures: number = 0;
    private maxConsecutiveFailures: number = 3; // Aumentado de 2 a 3 para reducir falsos positivos

    constructor(private readonly ollamaService: OllamaService) {}

    /**
     * Registra una invocación de herramienta y su resultado.
     * Retorna true si se detectó un bucle o patrón de fallos recurrentes.
     */
    public recordToolResult(toolName: string, args: any, result: ToolExecutionResult): boolean {
        const argsStr = JSON.stringify(args || {});
        const signature = `${toolName}:${argsStr}`;

        this.executedSignatures.add(signature);

        if (!result.success) {
            this.consecutiveFailures++;
            const currentFailCount = (this.failedSignatures.get(signature) || 0) + 1;
            this.failedSignatures.set(signature, currentFailCount);

            this.errorHistory.push({
                toolName,
                args: argsStr,
                error: result.output,
                timestamp: Date.now()
            });

            // BUG FIX: Detectar bucle con umbral más conservador
            const sameSignatureFailures = this.failedSignatures.get(signature) || 0;
            return this.consecutiveFailures >= this.maxConsecutiveFailures || sameSignatureFailures >= 2;
        } else {
            // BUG FIX: Resetear TAMBIÉN el historial de firmas fallidas para esta firma específica
            // (antes solo reseteaba consecutiveFailures, causando falsos positivos)
            this.consecutiveFailures = 0;
            this.failedSignatures.delete(signature); // Limpiar solo la firma que acaba de tener éxito
            return false;
        }
    }

    /**
     * Consulta a DeepSeek R1 para generar un plan de recuperación estructurado ante bucles de error
     */
    public async triggerDeepSeekRecovery(userGoal: string, currentContext: string): Promise<LoopRecoveryPlan> {
        const recentErrors = this.errorHistory.slice(-5);
        const errorTrace = recentErrors.map((e, idx) =>
            `[Fallo #${idx + 1}] Herramienta: ${e.toolName}\nArgumentos: ${e.args}\nResultado/Error: ${e.error}`
        ).join('\n\n');

        const reasoningPrompt = `SISTEMA DE RECUPERACIÓN DE BUCLES Y FALLOS (DEEPSEEK R1)

OBJETIVO PRINCIPAL DEL USUARIO:
${userGoal}

CONTEXTO ACTUAL:
${currentContext}

HISTORIAL DE ERRORES RECIENTES DEL AGENTE DE CÓDIGO:
${errorTrace}

INSTRUCCIONES DE ANÁLISIS:
1. Identifica la causa raíz exacta del fallo (ej. ruta incorrecta, archivo no encontrado, targetChunk erróneo en editFile, comando no instalado, sintaxis incorrecta).
2. Explica por qué el agente local cayó en un bucle o fallo recurrente.
3. Proporciona un nuevo plan paso a paso con comandos corregidos o acciones específicas para que el agente qwen2.5-coder resuelva el problema sin repetir el mismo error.
4. Si el error es de ruta de archivo, especifica la ruta correcta completa.
5. Si el error es de editFile, indica que primero debe leer el archivo con readFile para obtener el fragmento exacto.

Responde de forma clara, concisa y directa en español.`;

        const deepReasoning = await this.ollamaService.reasonDeeply(
            reasoningPrompt,
            'Eres DeepSeek R1, un motor de razonamiento de alto nivel especializado en análisis de fallos, debugging arquitectónico y recuperación de bucles de ejecución para agentes de código.'
        );

        // Resetear contadores de fallo tras generar el plan de rescate
        this.consecutiveFailures = 0;

        return {
            diagnosis: 'Se detectó un bucle recurrente de fallos en la ejecución de herramientas.',
            rootCause: 'Intentos reiterados con herramientas que arrojaron errores o rutas incorrectas.',
            recommendedActions: ['Revisar la guía de recuperación generada por DeepSeek R1', 'Aplicar los comandos corregidos'],
            revisedPromptForAgent: deepReasoning
        };
    }

    /**
     * Resetea completamente el historial de bucle (en clearChat o nuevo turno exitoso)
     */
    public reset(): void {
        this.errorHistory = [];
        this.executedSignatures = new Set();
        this.failedSignatures = new Map();
        this.consecutiveFailures = 0;
    }

    public getConsecutiveFailures(): number {
        return this.consecutiveFailures;
    }
}
