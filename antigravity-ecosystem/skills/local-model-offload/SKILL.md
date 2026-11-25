---
name: local-model-offload
description: Delega tareas mecánicas, repetitivas y de alto volumen de tokens a la Arquitectura de 4 Niveles (FreeLLMAPI en 127.0.0.1:3001, MCP Bridge en 127.0.0.1:3002/mcp, y Ollama local en 127.0.0.1:11434 como respaldo offline) para ahorrar tokens de nube y optimizar la ventana de contexto.
---

# Multi-Tier Model Offload (Delegación Multinivel a Obreros Gratuitos y Locales)

## Visión General
Esta habilidad permite a Antigravity Agent orquestar la delegación de subtareas rutinarias, sintácticas, de generación de código o procesamiento masivo a través de nuestra **Arquitectura de 4 Niveles** con **7 Proveedores Reales**:

1. **Nivel 1: Fastest Cloud Free (`http://127.0.0.1:3001` - FreeLLMAPI)**
   - **Cerebras Cloud:** `gpt-oss-120b`, `qwen-3.8-27b` (30ms WSE-3).
   - **Groq Cloud:** `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` (0.20s LPU).
2. **Nivel 2: General Cloud Free Pool (`http://127.0.0.1:3001` - FreeLLMAPI)**
   - **Cloudflare Workers AI:** `deepseek-r1-distill-32b`, `qwen2.5-coder-32b`, `llama-3.3-70b`.
   - **Cohere Cloud:** `command-r-plus-08-2024`, `command-r-08-2024` (128K context, optimizado para RAG).
   - **Google AI Studio (Free Tier):** `gemini-flash-latest`, `gemini-3.8-flash`.
   - **OpenRouter:** `cohere/north-mini-code:free`, `openrouter/free`.
3. **Nivel 3: Supervisor y Respaldo de Élite (Cuenta Pro Antigravity)**
   - **Google DeepMind / Antigravity Pro:** Orquesta, audita Diffs (`approve_worker_proposal`) y asume el control directo (`PRO_TAKEOVER`) si las nubes gratuitas entran en cooldown o fallan diagnósticos de LSP.
4. **Nivel 4: Último Recurso Offline (`http://127.0.0.1:11434` - Ollama Local)**
   - **Ollama Local:** `qwen2.5-coder:7b`, `qwen2.5-coder:3b`, `deepseek-r1:1.5b`, `nomic-embed-text`.
   - **Uso estricto:** Solo se invoca si no hay conexión a internet o con `strategy: "local_only"`.

---

## Integración MCP Global (`vibecoding-mcp`)
Antigravity se comunica con los obreros mediante las herramientas expuestas por `http://127.0.0.1:3002/mcp`:
- `delegate_to_freellm_worker(task, prompt, provider?, model?)`: Envía la tarea a FreeLLMAPI (Nivel 1 o 2).
- `approve_worker_proposal(proposalId)`: Aplica el Diff o código generado tras supervisión.
- `reject_worker_proposal(proposalId, reason)`: Rechaza la propuesta si no cumple los requisitos.

---

## Cuándo Delegar (Nivel 1 y 2 - 0 Costo de Cuenta Pro)
1. **Generación de Boilerplate & DTOs:** Interfaces TypeScript, esquemas, DTOs repetitivos.
2. **Generación de Mocks y Fixtures:** Datos de prueba sintéticos para tests unitarios.
3. **Documentación masiva y Docstrings:** JSDocs, comentarios explicativos y tipos sin alterar la lógica.
4. **Mensajes de Commit en Git:** Resumir el `git diff` y formatear un Conventional Commit.
5. **Transformaciones y Refactorizaciones Unitarias:** Migraciones de sintaxis en archivos aislados.

---

## Protocolo de Supervisión y Control de Calidad (Quality Gate)
1. **Delegación Inteligente:** Priorizar Cerebras y Groq (Nivel 1) por latencia, rotando a Cloudflare/Cohere/Google Free/OpenRouter (Nivel 2) si hay saturación.
2. **Inspección Obligatoria:** Antigravity (Nivel 3) siempre audita el Diff devuelto por el obrero antes de aplicarlo.
3. **Fallback Pro Takeover:** Si los proveedores gratuitos fallan o cometen errores de tipado/LSP reiterados, Antigravity Pro toma el control directo.
4. **Fallback Offline (Nivel 4):** Si se detecta desconexión total o `strategy: "local_only"`, se recurre al script local de Ollama en `127.0.0.1:11434`.
