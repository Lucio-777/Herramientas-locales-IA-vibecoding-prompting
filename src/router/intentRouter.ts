import { ExtensionConfig, IntentType, RoutingDecision } from '../types';

export class IntentRouter {
    constructor(private readonly config: ExtensionConfig) {}

    /**
     * Evalúa el mensaje del usuario, las imágenes adjuntas y el contexto para determinar el modelo óptimo.
     * JERARQUÍA DE 4 NIVELES:
     * Por defecto, TODAS las solicitudes se enrutan a FreeLLMAPI (127.0.0.1:3001) para máxima velocidad
     * y cero consumo de hardware local/RAM. Ollama (127.0.0.1:11434) solo se invoca si el usuario
     * especifica explícitamente '@local' o '#local'.
     */
    public route(userMessage: string, images?: string[]): RoutingDecision {
        const normalizedMsg = userMessage.toLowerCase().trim();
        const forceLocal = normalizedMsg.includes('@local') || normalizedMsg.includes('#local');

        // Detección de consulta sobre estado de proveedores y modelos del ecosistema
        const providerStatusKeywords = [
            'cuántos proveedores', 'cuantos proveedores', 'qué proveedores', 'que proveedores',
            'modelos tienes', 'modelos escuchando', 'modelos respondiendo', 'quién responde',
            'quien responde', 'estado de modelos', 'estado del ecosistema', 'cuántos modelos',
            'cuantos modelos', 'providers status', 'model status'
        ];
        const isProviderStatusRequest = providerStatusKeywords.some(kw => normalizedMsg.includes(kw));

        // 1. Detección de Imágenes -> Llama 3.2 Vision (FreeLLMAPI Vision Pool o Local)
        if (images && images.length > 0) {
            return {
                intent: 'VISION',
                targetModel: forceLocal ? (this.config.visionModel || 'llama3.2-vision:11b') : 'llama-3.2-11b-vision',
                reason: forceLocal
                    ? 'Se detectaron imágenes adjuntas con @local forzado. Enrutando a Llama 3.2 Vision local.'
                    : 'Se detectaron imágenes adjuntas. Enrutando a Llama 3.2 Vision Pool (FreeLLMAPI Nivel 2).',
                forceLocal,
                isProviderStatusRequest
            };
        }

        // 2. Detección de Razonamiento Profundo / Arquitectura / Consultoría de Producto / Debugging Teórico
        const reasoningKeywords = [
            // Español - Arquitectura y técnica
            'arquitectura', 'arquitecto', 'arquitecto de datos', 'base de datos', 'bases de datos',
            'diseña el sistema', 'diseño de sistema', 'diseño de base de datos', 'patrón de diseño',
            'analiza la arquitectura', 'razonamiento profundo', 'piensa paso a paso',
            'por qué ocurre este bug', 'por qué falla', 'teoría de', 'tradeoffs', 'trade-offs',
            'evalúa pros y contras', 'diagrama de arquitectura', 'diagrama er', 'diagramas er',
            'modelo relacional', 'esquema de datos', 'decisión técnica',
            'comparar enfoques', 'analiza el comportamiento', 'explica cómo funciona',
            'qué conviene', 'cuál es mejor', 'estrategia de', 'ventajas y desventajas',
            // Español - Producto, Startup, Negocio y Consultoría (PM/CTO/Inversionista)
            'product manager', 'cto de startup', 'consultor', 'inversionista', 'product owner',
            'analiza la idea', 'evalúa la idea', 'analiza el producto', 'evaluar la idea',
            'propuesta de valor', 'modelo de negocio', 'diferenciadores', 'casos de uso reales',
            'mercado objetivo', 'viabilidad', 'sé extremadamente crítico', 'crítico y propon',
            'análisis foda', 'análisis swot', 'riesgos y oportunidades', 'funcionalidades faltantes',
            'fase 1', 'fase 2', 'hoja de ruta de producto', 'pitch',
            // English - Architecture & Technical
            'architecture', 'architect', 'data architect', 'database design', 'database', 'er diagram',
            'relational model', 'system design', 'design pattern', 'analyze the architecture',
            'deep reasoning', 'think step by step', 'why does this bug', 'why is it failing',
            'tradeoff', 'pros and cons', 'architecture diagram', 'technical decision',
            'compare approaches', 'analyze behavior', 'explain how', 'which is better',
            'strategy for', 'advantages and disadvantages', 'when to use', 'best practice for',
            'refactor approach', 'design review',
            // English - Product, Startup & Strategy
            'product manager', 'product owner', 'startup cto', 'business model', 'value proposition',
            'investor pitch', 'feasibility analysis', 'critical analysis', 'market analysis',
            'differentiators', 'use cases', 'target market', 'missing features'
        ];

        const isReasoningRequest = isProviderStatusRequest || reasoningKeywords.some(kw => normalizedMsg.includes(kw));

        if (isReasoningRequest) {
            const targetModel = forceLocal 
                ? (this.config.reasoningModel || 'deepseek-r1:8b')
                : 'deepseek-r1-distill-qwen-32b';

            return {
                intent: 'REASONING',
                targetModel,
                reason: forceLocal
                    ? `Razonamiento profundo con @local forzado en Ollama (${targetModel}).`
                    : `Razonamiento profundo / Arquitectura. Enrutando a Nivel 2 Cloud Free Pool (${targetModel} vía FreeLLMAPI :3001).`,
                enhancedSystemPrompt: 'Eres DeepSeek R1 actuando como un analista experto, arquitecto de sistemas y consultor senior (PM/CTO/Inversionista). ' +
                    'Responde con pensamiento crítico, rigor analítico y una estructura impecable. ' +
                    'NUNCA transcribas ni recites guías internas o metodologías en crudo: aplica tu criterio directamente para responder a fondo la solicitud del usuario.',
                forceLocal,
                isProviderStatusRequest
            };
        }

        // 3. Orquestación Rápida: Consultas breves, saludos, commits, resúmenes
        const lightweightKeywords = [
            'explica qué hace', 'qué significa', 'crea un commit', 'mensaje de commit',
            'renombra', 'formatea', 'añade un comentario', 'documenta esta función',
            'quick', 'rápido', 'fast', '#fast', '@fast', 'hola', 'saludos', 'buenas'
        ];
        const isQuickTask = this.config.enableHybridRouting !== false && (
            (userMessage.length < 100 && lightweightKeywords.some(kw => normalizedMsg.includes(kw))) ||
            normalizedMsg.includes('#fast') || normalizedMsg.includes('@fast')
        );

        if (isQuickTask) {
            const targetModel = forceLocal
                ? (this.config.lightweightModel || 'qwen2.5-coder:3b')
                : 'gpt-oss-120b'; // Nivel 1 Fastest Cloud Free Cerebras/Groq

            return {
                intent: 'CODING_AGENT',
                targetModel,
                reason: forceLocal
                    ? `Tarea rápida en CPU local con ${targetModel}.`
                    : `Tarea rápida / consulta cotidiana. Enrutando a Nivel 1 Fastest Cloud Free (${targetModel} en Cerebras/Groq ~30ms).`,
                enhancedSystemPrompt: 'Eres un asistente de programación ultra-rápido integrado en VS Code. Responde con concisión, precisión y código listo para usar.',
                forceLocal,
                isProviderStatusRequest
            };
        }

        // 4. Flujo Predeterminado -> Agente de Código con Tool Calling
        const targetModel = forceLocal
            ? (this.config.codingModel || 'qwen2.5-coder:7b')
            : 'gpt-oss-120b'; // Nivel 1/2 vía FreeLLMAPI

        return {
            intent: 'CODING_AGENT',
            targetModel,
            reason: forceLocal
                ? `Agente de código local en Ollama (${targetModel}) con herramientas.`
                : `Agente de código con herramientas. Enrutando a Nivel 1/2 FreeLLMAPI (${targetModel} / auto) a latencia de milisegundos.`,
            enhancedSystemPrompt: 'Eres un asistente de programación experto (Agente VibeCoding) integrado en VS Code con acceso a herramientas reales del filesystem y terminal. Usa readFile, listDirectory y semanticSearch para explorar el código antes de modificarlo. Usa createFile y editFile para implementar cambios. Usa runCommand para ejecutar builds, tests e instalaciones. Siempre verifica que el archivo existe antes de editarlo.',
            forceLocal,
            isProviderStatusRequest
        };
    }
}
