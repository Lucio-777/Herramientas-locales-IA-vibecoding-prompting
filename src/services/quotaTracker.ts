import * as vscode from 'vscode';

export interface ProviderQuotaState {
    date: string; // YYYY-MM-DD
    requestsToday: number;
    tokensToday: number;
    lastUsedTimestamp: number;
}

export class QuotaTracker {
    private static instance: QuotaTracker;
    private context?: vscode.ExtensionContext;

    private constructor() {}

    public static getInstance(): QuotaTracker {
        if (!QuotaTracker.instance) {
            QuotaTracker.instance = new QuotaTracker();
        }
        return QuotaTracker.instance;
    }

    public init(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private getTodayString(): string {
        const now = new Date();
        return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    }

    private getQuotaState(provider: 'gemini' | 'groq'): ProviderQuotaState {
        const today = this.getTodayString();
        const key = `quota_state_${provider}`;
        const saved = this.context?.globalState.get<ProviderQuotaState>(key);

        if (saved && saved.date === today) {
            return saved;
        }

        // Si es un nuevo día o no existe, reiniciar contadores
        return {
            date: today,
            requestsToday: 0,
            tokensToday: 0,
            lastUsedTimestamp: 0
        };
    }

    private async saveQuotaState(provider: 'gemini' | 'groq', state: ProviderQuotaState) {
        const key = `quota_state_${provider}`;
        await this.context?.globalState.update(key, state);
    }

    /**
     * Verifica si el proveedor puede ser utilizado sin superar el porcentaje límite estricto
     */
    public canUseProvider(provider: 'gemini' | 'groq'): { allowed: boolean; reason?: string; usageText: string } {
        const config = vscode.workspace.getConfiguration('vibe-coding-local');
        const state = this.getQuotaState(provider);

        // Límites configurados
        let maxDailyLimit = 100;
        let percentageCap = 10;

        if (provider === 'gemini') {
            maxDailyLimit = config.get<number>('geminiDailyLimit', 75); // 5% de 1500 peticiones/día
            percentageCap = config.get<number>('geminiQuotaPercentage', 5);
        } else {
            maxDailyLimit = config.get<number>('groqDailyLimit', 140); // 10% de 1440 peticiones/día
            percentageCap = config.get<number>('groqQuotaPercentage', 10);
        }

        const usagePercentage = ((state.requestsToday / maxDailyLimit) * percentageCap).toFixed(1);
        const usageText = `${state.requestsToday}/${maxDailyLimit} peticiones usadas hoy (${usagePercentage}% de tu cuota de ${percentageCap}%)`;

        if (state.requestsToday >= maxDailyLimit) {
            return {
                allowed: false,
                reason: `Límite estricto de seguridad alcanzado para ${provider.toUpperCase()} (${percentageCap}% máximo configurado). No se consumirá más cuota hasta el reinicio diario (00:00 UTC).`,
                usageText
            };
        }

        return {
            allowed: true,
            usageText
        };
    }

    /**
     * Registra una petición consumida
     */
    public async recordUsage(provider: 'gemini' | 'groq') {
        const state = this.getQuotaState(provider);
        state.requestsToday += 1;
        state.lastUsedTimestamp = Date.now();
        await this.saveQuotaState(provider, state);
    }

    /**
     * Retorna un resumen de uso para mostrar al usuario
     */
    public getUsageReport(): { gemini: string; groq: string } {
        const geminiCheck = this.canUseProvider('gemini');
        const groqCheck = this.canUseProvider('groq');
        return {
            gemini: geminiCheck.usageText,
            groq: groqCheck.usageText
        };
    }
}
