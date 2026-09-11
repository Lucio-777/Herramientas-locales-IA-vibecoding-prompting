import { ExtensionConfig, IntentType, RoutingDecision } from '../types';

export class IntentRouter {
    constructor(private readonly config: ExtensionConfig) {}

    /**
     * Evalúa el mensaje del usuario, las imágenes adjuntas y el contexto para determinar el modelo óptimo.
     * Soporta palabras clave en español e inglés.
     */
    public route(userMessage: string, images?: string[]): RoutingDecision {
        const normalizedMsg = userMessage.toLowerCase().trim();

        // 1. Detección de Imágenes -> Llama 3.2 Vision
        if (images && images.length > 0) {
            return {
                intent: 'VISION',
                targetModel: this.config.visionModel,
                reason: 'Se detectaron imágenes adjuntas (mockups, diagramas, capturas). Enrutando a Llama 3.2 Vision.'
            };
        }

        // 2. Detección de Razonamiento Profundo / Arquitectura / Consultoría de Producto / Debugging Teórico -> DeepSeek R1
        // Palabras clave en español e inglés
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

        const isReasoningRequest = reasoningKeywords.some(kw => normalizedMsg.includes(kw));

        if (isReasoningRequest) {
            return {
                intent: 'REASONING',
                targetModel: this.config.reasoningModel,
                reason: 'La consulta requiere análisis arquitectónico, conceptual, de producto o razonamiento profundo. Enrutando a DeepSeek R1.',
                enhancedSystemPrompt: 'Eres DeepSeek R1 actuando como un analista experto, arquitecto de sistemas y consultor senior (PM/CTO/Inversionista). ' +
                    'Responde con pensamiento crítico, razonamiento profundo y una estructura analítica impecable. ' +
                    'NUNCA transcribas, recites ni listes guías o metodologías internas en crudo; aplica tu criterio directamente para responder a fondo la solicitud del usuario.'
            };
        }

        // 3. Flujo Predeterminado -> Agente de Código con Tool Calling (Qwen Coder)
        return {
            intent: 'CODING_AGENT',
            targetModel: this.config.codingModel,
            reason: 'Solicitud de programación, inspección de archivos, ejecución de comandos o refactorización. Enrutando al Agente de Código con herramientas.',
            enhancedSystemPrompt: 'Eres un asistente de programación experto (Agente VibeCoding) integrado en VS Code con acceso a herramientas reales del filesystem y terminal. Usa readFile, listDirectory y semanticSearch para explorar el código antes de modificarlo. Usa createFile y editFile para implementar cambios. Usa runCommand para ejecutar builds, tests e instalaciones. Siempre verifica que el archivo existe antes de editarlo.'
        };
    }
}
