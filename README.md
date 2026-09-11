# VibeCoding Local 🚀

> **Asistente de desarrollo VibeCoding 100% local y privado para Visual Studio Code con soporte para Ollama.**

**VibeCoding Local** es una extensión avanzada de VS Code diseñada para desarrolladores que desean la potencia de un copiloto y agente de IA autónomo sin enviar su código a servidores externos o nubes comerciales. Todo el procesamiento, inferencia, incrustaciones y herramientas se ejecutan de manera completamente local.

---

## ✨ Características Principales

- **🔒 100% Local y Privado**: Conexión nativa con tu instancia local de [Ollama](https://ollama.com) (`http://localhost:11434`). Tus datos y código nunca salen de tu máquina.
- **⚡ Soporte Multi-Modelo Inteligente**:
  - **Generación de Código**: Optimizado para modelos de alto rendimiento como `qwen2.5-coder:7b` / `14b`.
  - **Razonamiento Profundo**: Compatible con `deepseek-r1:8b` / `14b` para tareas lógicas complejas y refactorizaciones.
  - **Visión Multimodal**: Integración con `llama3.2-vision` para análisis de capturas, maquetas y diagramas.
  - **Embeddings**: Búsqueda semántica y RAG local impulsado por `nomic-embed-text`.
- **🛠️ Tool Calling Quirúrgico & Autónomo**:
  - **Manipulación de Archivos**: Creación, lectura, edición precisa y reemplazo sin placeholders.
  - **Ejecución de Terminal Controlada**: Comandos de compilación, instalación y pruebas con confirmación y captura de salida.
  - **Diagnósticos LSP en Tiempo Real**: Detección automática de errores de sintaxis y tipado (`tsc`, `eslint`) para autorreparación de código.
  - **Diff Interactivo**: Visualización de diferencias antes de aplicar cambios estructurales.
- **🧠 Enrutador de Intenciones & Detección de Bucles**:
  - `IntentRouter` para clasificar las solicitudes y seleccionar la mejor estrategia de prompting/herramientas.
  - `LoopDetector` para prevenir bucles infinitos en ejecución de tareas complejas de agentes.
- **📚 Sistema de Reglas y Catálogo de Skills**:
  - Personalización de comportamiento por proyecto a través de `.vibecoding/rules.md`.
  - Mapeo automático de habilidades según el perfil del proyecto (`ProjectProfiler`).

---

## 📂 Estructura del Proyecto

```
Herramientas-locales-IA-vibecoding-prompting/
├── .vibecoding/
│   └── rules.md                # Reglas personalizadas de desarrollo local
├── media/                      # Estilos, scripts e iconos del Webview
├── src/
│   ├── chatViewProvider.ts     # Controlador principal del panel lateral Webview
│   ├── cloudFilter.ts          # Filtro y verificador de privacidad
│   ├── extension.ts            # Punto de entrada de la extensión de VS Code
│   ├── router/
│   │   └── intentRouter.ts     # Enrutador inteligente de intenciones del usuario
│   ├── services/
│   │   ├── diffService.ts      # Generador y gestor de diffs de código
│   │   ├── loopDetector.ts     # Prevención de bucles en llamadas a herramientas
│   │   ├── ollamaService.ts    # Cliente y streaming con Ollama API
│   │   ├── projectProfiler.ts  # Detección de stack tecnológico del workspace
│   │   ├── quotaTracker.ts     # Monitoreo de recursos y tokens
│   │   ├── rulesService.ts     # Carga y gestión de reglas del proyecto
│   │   ├── skillCatalogService.ts # Catálogo de capacidades y herramientas
│   │   └── skillMatcher.ts     # Asociación de habilidades a contextos
│   ├── tools/
│   │   ├── diagnosticTools.ts  # Integración con diagnósticos de VS Code (LSP)
│   │   ├── fileTools.ts        # Operaciones de sistema de archivos
│   │   ├── index.ts            # Registro de herramientas
│   │   ├── ragTools.ts         # Búsqueda semántica y RAG
│   │   └── terminalTools.ts    # Ejecución controlada en terminal
│   └── types/
│       └── index.ts            # Definición de interfaces y tipos TypeScript
├── package.json
└── tsconfig.json
```

---

## 🚀 Requisitos Previos

1. **Visual Studio Code** (versión 1.90.0 o superior).
2. **Node.js** (versión 18 o superior) y `npm`.
3. **Ollama**:
   - Descarga e instala [Ollama](https://ollama.com).
   - Descarga los modelos recomendados:
     ```bash
     ollama pull qwen2.5-coder:7b
     ollama pull deepseek-r1:8b
     ollama pull nomic-embed-text
     ```

---

## 💻 Instalación y Desarrollo

1. Clonar el repositorio:
   ```bash
   git clone https://github.com/Lucio-777/Herramientas-locales-IA-vibecoding-prompting.git
   cd Herramientas-locales-IA-vibecoding-prompting
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Compilar el proyecto:
   ```bash
   npm run compile
   ```
   O compilar en modo observación (watch):
   ```bash
   npm run watch
   ```

4. Probar la extensión:
   - Presiona `F5` en VS Code para abrir una nueva ventana de **Extension Development Host**.
   - Abre la barra lateral y haz clic en el icono de **VibeCoding Local**.

---

## 📄 Licencia

Este proyecto se distribuye bajo la licencia MIT. Consulta el archivo correspondiente para más información.
