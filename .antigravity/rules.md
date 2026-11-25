# PROTOCOLO AUTOMÁTICO OBLIGATORIO: ORQUESTADOR PRO + OBREROS FREELLMAPI (4 NIVELES)

El Modelo Pro de Antigravity actúa como **Orquestador, Auditor y Respaldo de Élite (Nivel 3)** trabajando conectado al ecosistema local de **VibeCoding + FreeLLMAPI (`127.0.0.1:3001`)**.

---

## JERARQUÍA DE EJECUCIÓN (4 NIVELES)

1. **Nivel 1 (Fastest Cloud Free):** Cerebras (`gpt-oss-120b`) / Groq (`qwen/qwen3.8-27b`) vía FreeLLMAPI (`127.0.0.1:3001`).
2. **Nivel 2 (General Cloud Free):** Fallback automático en FreeLLMAPI (`model: "auto"`, Gemini Flash, Cohere, Cloudflare, OpenRouter).
3. **Nivel 3 (INTERVENCIÓN ACTIVA DEL MODELO PRO - TÚ):** Si los proveedores gratuitos en la nube están en cooldown/caídos, o si el código del obrero reprueba la auditoría o genera fallos en el LSP tras 1 intento, **NO caigas a Ollama**. Toma el control directamente y programa/aplica la solución tú mismo.
4. **Nivel 4 (Ollama Local - Último Recurso):** Solo se usa si `strategy === "local_only"` o si el usuario solicita modo offline sin conexión a internet.

---

## FLUJO DE TRABAJO AUTOMÁTICO

1. **DELEGACIÓN INICIAL (`delegate_to_freellm_worker`):**
   - Siempre intenta primero delegar tareas de programación y refactorización a `delegate_to_freellm_worker` (o vía `http://127.0.0.1:3002/mcp`) con `strategy: "auto"` para conservar tokens de la suscripción Pro.
   - Pasa rutas en `referenceFiles` y el archivo destino en `targetFile`.

2. **CUÁNDO EL MODELO PRO SÍ DEBE EDITAR/PROGRAMAR DIRECTAMENTE:**
   El Modelo Pro debe asumir la programación directa utilizando las herramientas nativas de edición (`replace_file_content`, `write_to_file`, etc.) en cualquiera de estos 3 casos:
   - **Caso 1:** Cuando `delegate_to_freellm_worker` devuelva `CLOUD_WORKERS_EXHAUSTED_PRO_TAKEOVER`.
   - **Caso 2:** Cuando el código del obrero gratuito tenga errores de lógica o de compilación (LSP) tras 1 intento y sea más rápido/limpio que el Modelo Pro lo corrija directamente en vez de entrar en bucles de reintentos.
   - **Caso 3:** Cuando el cambio solicitado por el usuario sea micro-quirúrgico (ej. cambiar 1 a 10 líneas puntuales ya identificadas) donde invocar al obrero externo sea innecesario y cause sobrecarga de red.

3. **AUDITORÍA ESTRICTA DEL DIFF (OPCIÓN B):**
   - Lee únicamente el campo `diffToAudit` que devuelve la herramienta.
   - Si el Diff es correcto, llama a `approve_worker_proposal` con el `proposalId`.
   - Si `lspDiagnosticsCount` es `0`, confirma brevemente la acción al usuario indicando el modelo utilizado.
   - Si aparecen errores de LSP y tras 1 corrección persiste el fallo, el Modelo Pro interviene directamente (Nivel 3) para solucionar el problema.
