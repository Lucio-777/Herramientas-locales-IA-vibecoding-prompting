import * as vscode from 'vscode';
import { QuotaTracker } from './services/quotaTracker';

export async function enhancePromptWithCloud(
    userMessage: string,
    contextString: string,
    historyString: string
): Promise<{ enhancedPrompt: string; providerUsed?: string; usageInfo?: string }> {
    const config = vscode.workspace.getConfiguration('vibe-coding-local');
    const enabled = config.get<boolean>('cloudFilterEnabled', false); // BUG FIX: default false (consistente con chatViewProvider)
    const selectedProvider = config.get<'auto' | 'groq' | 'gemini'>('cloudProvider', 'auto');

    if (!enabled) {
        return { enhancedPrompt: userMessage };
    }

    const groqApiKey = config.get<string>('groqApiKey', '');
    const geminiApiKey = config.get<string>('geminiApiKey', '');
    const groqModel = config.get<string>('groqModel', 'llama-3.3-70b-versatile');
    const geminiModel = config.get<string>('geminiModel', 'gemini-2.0-flash');

    // BUG FIX: Si ningún proveedor tiene clave configurada, retornar silenciosamente
    if (!groqApiKey && !geminiApiKey) {
        console.log('[VibeCoding Cloud] No hay claves API configuradas. Cloud Filter desactivado automáticamente.');
        return { enhancedPrompt: userMessage };
    }

    const tracker = QuotaTracker.getInstance();

    // Determinar orden de proveedores según disponibilidad y límites de cuota
    let providersToTry: ('gemini' | 'groq')[] = [];
    if (selectedProvider === 'gemini') {
        providersToTry = ['gemini', 'groq'];
    } else if (selectedProvider === 'groq') {
        providersToTry = ['groq', 'gemini'];
    } else {
        providersToTry = ['gemini', 'groq'];
    }

    // BUG FIX: Filtrar proveedores que no tienen clave configurada para evitar notificación falsa
    const providersWithKeys = providersToTry.filter(p =>
        (p === 'gemini' && geminiApiKey) || (p === 'groq' && groqApiKey)
    );

    if (providersWithKeys.length === 0) {
        return { enhancedPrompt: userMessage };
    }

    const systemPrompt = `Eres un Meta-Prompt Engineer de élite. Tu único trabajo es recibir la petición del usuario, el contexto de su código y su historial, y redactar un PROMPT EXTREMADAMENTE DETALLADO Y ESPECÍFICO.
Este prompt generado se le entregará a un modelo local más pequeño (Qwen Coder en Ollama).
Tu prompt debe instruir al modelo paso a paso, especificar nombres de archivos exactos, validaciones y arquitectura clara.

REGLA CRÍTICA: NO respondas tú a la pregunta del usuario. Solo redacta el "súper prompt" que ejecutará el modelo local.`;

    const userPrompt = `PETICIÓN DEL USUARIO:
${userMessage}

HISTORIAL DEL CHAT:
${historyString}

CONTEXTO DEL PROYECTO:
${contextString}

Por favor, genera el Súper Prompt estructurado ahora.`;

    let quotaExhaustedCount = 0;

    for (const provider of providersWithKeys) {
        const quotaCheck = tracker.canUseProvider(provider);
        if (!quotaCheck.allowed) {
            console.warn(`[VibeCoding Cloud] ${quotaCheck.reason}`);
            quotaExhaustedCount++;
            continue;
        }

        if (provider === 'gemini') {
            try {
                const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${geminiApiKey}`
                    },
                    body: JSON.stringify({
                        model: geminiModel,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.2
                    })
                });

                if (response.ok) {
                    const data: any = await response.json();
                    const enhanced = data.choices[0]?.message?.content?.trim();
                    if (enhanced) {
                        await tracker.recordUsage('gemini');
                        return {
                            enhancedPrompt: enhanced,
                            providerUsed: `Gemini (${geminiModel})`,
                            usageInfo: tracker.canUseProvider('gemini').usageText
                        };
                    }
                } else {
                    console.error('[Gemini API Error]', await response.text());
                }
            } catch (err: any) {
                console.error('[Gemini Filter Error]', err.message);
            }
        } else if (provider === 'groq') {
            try {
                const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${groqApiKey}`
                    },
                    body: JSON.stringify({
                        model: groqModel,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt }
                        ],
                        temperature: 0.2
                    })
                });

                if (response.ok) {
                    const data: any = await response.json();
                    const enhanced = data.choices[0]?.message?.content?.trim();
                    if (enhanced) {
                        await tracker.recordUsage('groq');
                        return {
                            enhancedPrompt: enhanced,
                            providerUsed: `Groq (${groqModel})`,
                            usageInfo: tracker.canUseProvider('groq').usageText
                        };
                    }
                } else {
                    console.error('[Groq API Error]', await response.text());
                }
            } catch (err: any) {
                console.error('[Groq Filter Error]', err.message);
            }
        }
    }

    // BUG FIX: Solo mostrar notificación de límite si realmente hubo intentos que alcanzaron cuota,
    // no simplemente porque no hay claves API
    if (quotaExhaustedCount > 0 && quotaExhaustedCount === providersWithKeys.length) {
        const usageReport = tracker.getUsageReport();
        vscode.window.showInformationMessage(
            `[VibeCoding] Límite de cuota alcanzado (Gemini: ${usageReport.gemini} | Groq: ${usageReport.groq}). Se usará el prompt local.`
        );
    }

    return { enhancedPrompt: userMessage };
}
