import * as vscode from 'vscode';
import { QuotaTracker } from './services/quotaTracker';

export async function enhancePromptWithCloud(
    userMessage: string,
    contextString: string,
    historyString: string
): Promise<{ enhancedPrompt: string; providerUsed?: string; usageInfo?: string }> {
    const config = vscode.workspace.getConfiguration('vibe-coding-local');
    const enabled = config.get<boolean>('cloudFilterEnabled', false); // BUG FIX: default false (consistente con chatViewProvider)
    const selectedProvider = config.get<'auto' | 'groq' | 'gemini' | 'freellmapi'>('cloudProvider', 'auto');

    if (!enabled) {
        return { enhancedPrompt: userMessage };
    }

    const groqApiKey = config.get<string>('groqApiKey', '');
    const geminiApiKey = config.get<string>('geminiApiKey', '');
    const groqModel = config.get<string>('groqModel', 'llama-3.3-70b-versatile');
    const geminiModel = config.get<string>('geminiModel', 'gemini-2.0-flash');
    const freellmApiUrl = config.get<string>('freellmApiUrl', 'http://127.0.0.1:3001/v1');
    const freellmApiKey = config.get<string>('freellmApiKey', '') || process.env.FREELLM_API_KEY || 'freellmapi-86a31ceb7d1a23a23a9d761e0d2c92dfc9efb25675381691';
    const freellmModel = config.get<string>('freellmModel', 'auto');

    const lowerMsg = userMessage.toLowerCase().trim();

    // 1. Si el usuario solicita explícitamente modo local (@local o #local), omitir la nube
    if (lowerMsg.includes('@local') || lowerMsg.includes('#local')) {
        const cleanMsg = userMessage.replace(/[@#]local\b/gi, '').trim();
        return { enhancedPrompt: cleanMsg || userMessage };
    }

    // 2. Ahorro de Tokens y Preservación de Cuota:
    // Si el mensaje es breve (< 80 caracteres) y no pide explícitamente nube (@cloud),
    // resolver 100% en local para no malgastar cuota en preguntas triviales o saludos.
    const isExplicitCloud = lowerMsg.includes('@cloud') || lowerMsg.includes('#cloud');
    if (!isExplicitCloud && userMessage.trim().length < 80) {
        return { enhancedPrompt: userMessage };
    }

    const effectiveUserMessage = isExplicitCloud 
        ? userMessage.replace(/[@#]cloud\b/gi, '').trim() 
        : userMessage;

    // Si ningún proveedor tiene clave ni FreeLLMAPI configurado, retornar silenciosamente
    const hasFreeLLM = !!freellmApiUrl;
    if (!groqApiKey && !geminiApiKey && !hasFreeLLM) {
        console.log('[VibeCoding Cloud] No hay proveedores en la nube configurados. Cloud Filter desactivado automáticamente.');
        return { enhancedPrompt: effectiveUserMessage };
    }

    const tracker = QuotaTracker.getInstance();

    // Determinar orden de proveedores: FreeLLMAPI tiene prioridad en 'auto' porque gestiona rotación de cuotas gratuitas
    let providersToTry: ('freellmapi' | 'gemini' | 'groq')[] = [];
    if (selectedProvider === 'freellmapi') {
        providersToTry = ['freellmapi'];
    } else if (selectedProvider === 'gemini') {
        providersToTry = ['gemini', 'groq', 'freellmapi'];
    } else if (selectedProvider === 'groq') {
        providersToTry = ['groq', 'gemini', 'freellmapi'];
    } else {
        providersToTry = ['freellmapi', 'gemini', 'groq'];
    }

    const providersWithKeys = providersToTry.filter(p =>
        (p === 'freellmapi' && hasFreeLLM) ||
        (p === 'gemini' && geminiApiKey) ||
        (p === 'groq' && groqApiKey)
    );

    if (providersWithKeys.length === 0) {
        return { enhancedPrompt: effectiveUserMessage };
    }

    const systemPrompt = `Eres un Meta-Prompt Engineer de élite. Tu único trabajo es recibir la petición del usuario, el contexto de su código y su historial, y redactar un PROMPT EXTREMADAMENTE DETALLADO Y ESPECÍFICO.
Este prompt generado se le entregará a un modelo local más pequeño (Qwen Coder en Ollama).
Tu prompt debe instruir al modelo paso a paso, especificar nombres de archivos exactos, validaciones y arquitectura clara.

REGLA CRÍTICA: NO respondas tú a la pregunta del usuario. Solo redacta el "súper prompt" que ejecutará el modelo local.`;

    const userPrompt = `PETICIÓN DEL USUARIO:
${effectiveUserMessage}

HISTORIAL DEL CHAT:
${historyString}

CONTEXTO DEL PROYECTO:
${contextString}

Por favor, genera el Súper Prompt estructurado ahora.`;

    let quotaExhaustedCount = 0;

    for (const provider of providersWithKeys) {
        if (provider === 'freellmapi') {
            try {
                const endpoint = `${freellmApiUrl.replace(/\/+$/, '')}/chat/completions`;
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json'
                };
                if (freellmApiKey) {
                    headers['Authorization'] = `Bearer ${freellmApiKey}`;
                }
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: freellmModel || 'auto',
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
                        return {
                            enhancedPrompt: enhanced,
                            providerUsed: `FreeLLMAPI (${data.model || freellmModel}) [Failover Multi-Nube]`,
                            usageInfo: 'Rotación ilimitada'
                        };
                    }
                }
            } catch (err: any) {
                console.warn('[FreeLLMAPI Filter Error]', err.message);
            }
            continue;
        }

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
