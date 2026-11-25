# Directiva Global de Antigravity: Arquitectura de 4 Niveles y Conservación de Tokens

## Principio Fundamental
Para preservar la cuota de suscripción del usuario, minimizar la latencia y optimizar la ventana de contexto de los modelos en la nube, Antigravity DEBE operar de forma predeterminada bajo la **Arquitectura Híbrida de 4 Niveles** integrando los **7 Proveedores Reales** de nuestro ecosistema.

---

## 1. Definición de la Arquitectura de 4 Niveles (7 Proveedores)

### Nivel 1: Fastest Cloud Free (http://127.0.0.1:3001 - FreeLLMAPI)
Máxima velocidad de respuesta e inferencia ultra rápida para autocompletado, transformaciones y generación de código:
- **Cerebras Cloud:** `gpt-oss-120b`, `qwen-3.8-27b` (~30ms en WSE-3).
- **Groq Cloud:** `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` (~0.20s en LPU).

### Nivel 2: General Cloud Free Pool (http://127.0.0.1:3001 - FreeLLMAPI)
Pool gratuito de alta capacidad, contexto amplio y soporte de razonamiento:
- **Cloudflare Workers AI:** `deepseek-r1-distill-32b`, `qwen2.5-coder-32b`, `llama-3.3-70b`.
- **Cohere Cloud:** `command-r-plus-08-2024`, `command-r-08-2024` (128K context, optimizado para RAG).
- **Google AI Studio (Free Tier):** `gemini-flash-latest`, `gemini-3.8-flash`.
- **OpenRouter:** `cohere/north-mini-code:free`, `openrouter/free`.

### Nivel 3: Supervisor y Respaldo de Élite (Cuenta Pro Antigravity)
- **Google DeepMind / Antigravity Pro:**
  - Orquestador principal, diseño arquitectónico de alto nivel y límites de módulos.
  - Auditoría de Diffs propuestos por los obreros (`approve_worker_proposal`, `reject_worker_proposal`).
  - Control directo (`PRO_TAKEOVER`) si las nubes gratuitas entran en cooldown, superan rate limits o fallan diagnósticos LSP/TypeScript.
  - Auditorías de seguridad OWASP y validación crítica de seguridad.

### Nivel 4: Último Recurso Offline (http://127.0.0.1:11434 - Ollama Local)
Inferencia 100% local en hardware Intel i7-1355U / 16GB RAM:
- **Ollama Local:** `qwen2.5-coder:7b`, `qwen2.5-coder:3b`, `deepseek-r1:1.5b`, `nomic-embed-text`.
- **Condición de uso:** Se invoca **únicamente** si no hay conexión a internet o cuando el usuario especifica explícitamente `strategy: "local_only"`. No bloquear ni asumir que Ollama está activo por defecto.

---

## 2. Delegación y Protocolo MCP (http://127.0.0.1:3002/mcp)
Antigravity interactúa con los obreros mediante el servidor MCP global `vibecoding-mcp`:
1. `delegate_to_freellm_worker`: Enviar tareas mecánicas, boilerplate, docstrings o tests a los modelos de Nivel 1 y 2.
2. `approve_worker_proposal`: Validar e incorporar cambios propuestos tras revisión.
3. `reject_worker_proposal`: Descartar propuestas que no cumplan los estándares de calidad.

---

## 3. Restricciones de Hardware y Control de Calidad (Quality Gate)
1. **Hardware:** Intel Core i7-1355U (10 núcleos, 12 hilos), 16 GB RAM, gráficos Intel Iris Xe.
2. **Prioridad de Ruteo:** Enviar tareas siempre primero al pool Nivel 1 / Nivel 2 vía FreeLLMAPI (`127.0.0.1:3001`).
3. **Supervisión Obligatoria:** Antigravity (Nivel 3) siempre valida sintaxis, tipos y congruencia antes de aplicar propuestas.
4. **Fallback Transparente:** Si un proveedor entra en rate limit o cooldown, rotar automáticamente en el pool de FreeLLMAPI sin interrumpir al usuario.

