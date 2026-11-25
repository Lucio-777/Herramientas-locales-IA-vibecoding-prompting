import { ToolDefinition, ToolExecutionResult } from '../types';
import { FileTools } from './fileTools';
import { TerminalTools } from './terminalTools';
import { RAGTools } from './ragTools';
import { DiagnosticTools } from './diagnosticTools';
import { OllamaService } from '../services/ollamaService';


export const AGENT_TOOLS: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'readFile',
            description: 'Lee el contenido de un archivo en el workspace con números de línea y control de longitud. Ideal para inspeccionar código antes de editarlo.',
            parameters: {
                type: 'object',
                properties: {
                    filePath: {
                        type: 'string',
                        description: 'Ruta relativa o absoluta del archivo a leer.'
                    },
                    startLine: {
                        type: 'number',
                        description: 'Número de línea inicial (1-indexed). Opcional.'
                    },
                    endLine: {
                        type: 'number',
                        description: 'Número de línea final (1-indexed, inclusivo). Opcional.'
                    }
                },
                required: ['filePath']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'createFile',
            description: 'Crea un archivo nuevo con el contenido proporcionado. Crea automáticamente los directorios intermedios si no existen.',
            parameters: {
                type: 'object',
                properties: {
                    filePath: {
                        type: 'string',
                        description: 'Ruta del archivo a crear.'
                    },
                    content: {
                        type: 'string',
                        description: 'Contenido completo inicial del archivo.'
                    }
                },
                required: ['filePath', 'content']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'editFile',
            description: 'Aplica una modificación quirúrgica resiliente a un archivo existente. Puede reemplazar el bloque targetChunk (con coincidencia exacta o difusa tolerante a espacios) o reemplazar directamente por rango de líneas con startLine y endLine. Guarda un backup automático.',
            parameters: {
                type: 'object',
                properties: {
                    filePath: {
                        type: 'string',
                        description: 'Ruta del archivo existente a editar.'
                    },
                    targetChunk: {
                        type: 'string',
                        description: 'El fragmento de texto a sustituir en el archivo. Opcional si se especifica startLine y endLine.'
                    },
                    replacement: {
                        type: 'string',
                        description: 'El nuevo fragmento de texto de reemplazo.'
                    },
                    startLine: {
                        type: 'number',
                        description: 'Línea inicial (1-indexed) para reemplazo por rango. Opcional.'
                    },
                    endLine: {
                        type: 'number',
                        description: 'Línea final (1-indexed, inclusivo) para reemplazo por rango. Opcional.'
                    }
                },
                required: ['filePath', 'replacement']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'restoreBackup',
            description: 'Restaura un archivo modificado a su versión previa usando los backups automáticos guardados en .vibecoding/backups/.',
            parameters: {
                type: 'object',
                properties: {
                    filePath: {
                        type: 'string',
                        description: 'Ruta del archivo a restaurar.'
                    }
                },
                required: ['filePath']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'listDirectory',
            description: 'Explora la estructura de archivos y carpetas del workspace de forma estructurada, ignorando node_modules y directorios pesados.',
            parameters: {
                type: 'object',
                properties: {
                    dirPath: {
                        type: 'string',
                        description: 'Ruta de la carpeta a explorar. Si se omite, explora la raíz del proyecto.'
                    },
                    maxDepth: {
                        type: 'number',
                        description: 'Profundidad máxima de recursión (por defecto 3).'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'runCommand',
            description: 'Ejecuta un comando en la terminal de forma asíncrona y captura stdout, stderr y código de salida.',
            parameters: {
                type: 'object',
                properties: {
                    command: {
                        type: 'string',
                        description: 'El comando de terminal a ejecutar (ej. npm test, git status, etc).'
                    },
                    cwd: {
                        type: 'string',
                        description: 'Directorio de trabajo para el comando. Opcional.'
                    }
                },
                required: ['command']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'analyzeActiveTerminal',
            description: 'Captura el buffer y las trazas de error recientes de la terminal activa del usuario en VS Code para diagnóstico inmediato.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'semanticSearch',
            description: 'Realiza una búsqueda semántica (RAG) en el workspace usando embeddings vectoriales para encontrar archivos o funciones relevantes por significado.',
            parameters: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'La consulta en lenguaje natural o concepto técnico a buscar en el código.'
                    },
                    topK: {
                        type: 'number',
                        description: 'Número de fragmentos más relevantes a retornar (por defecto 4).'
                    }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generateProjectContext',
            description: 'Genera o actualiza el archivo de contexto global del proyecto (contexto/contexto_proyecto.md) analizando el árbol de archivos y configuraciones principales.',
            parameters: {
                type: 'object',
                properties: {}
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getWorkspaceDiagnostics',
            description: 'Consulta los errores de compilación, sintaxis, advertencias de TypeScript y linters del panel de problemas de VS Code.',
            parameters: {
                type: 'object',
                properties: {
                    severity: {
                        type: 'string',
                        description: 'Filtrar por severidad: Error, Warning o All.',
                        enum: ['Error', 'Warning', 'All']
                    },
                    targetFile: {
                        type: 'string',
                        description: 'Ruta del archivo específico a consultar. Opcional.'
                    }
                }
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'consultSkill',
            description: 'Consulta y lee las instrucciones especializadas de una skill del catálogo local por su nombre o tecnología (ej. flutter, react, bigquery, a11y, git).',
            parameters: {
                type: 'object',
                properties: {
                    skillNameOrKeyword: {
                        type: 'string',
                        description: 'Nombre de la skill o palabra clave a buscar.'
                    }
                },
                required: ['skillNameOrKeyword']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'delegate_to_freellm_worker',
            description: 'Opción B: delega la escritura de un archivo a un obrero FreeLLMAPI (fallback Ollama). Lee targetFile y referenceFiles localmente, deja la propuesta en staging y devuelve solo { proposalId, diffToAudit }. NO escribe a disco.',
            parameters: {
                type: 'object',
                properties: {
                    taskInstruction: { type: 'string', description: 'Instrucción quirúrgica para el obrero.' },
                    targetFile: { type: 'string', description: 'Archivo a crear/modificar (relativo al workspace).' },
                    referenceFiles: { type: 'array', items: { type: 'string' }, description: 'Archivos de contexto leídos localmente (0 tokens Pro).' },
                    strategy: { type: 'string', description: 'Enrutamiento del obrero.', enum: ['auto', 'massive_context', 'ultra_fast', 'deep_reasoning', 'local_only'] }
                },
                required: ['taskInstruction', 'targetFile']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'approve_worker_proposal',
            description: 'Escribe a disco una propuesta en staging tras auditarla y devuelve los diagnósticos LSP del archivo (errores/warnings).',
            parameters: {
                type: 'object',
                properties: {
                    proposalId: { type: 'string', description: 'ID devuelto por delegate_to_freellm_worker.' }
                },
                required: ['proposalId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'reject_worker_proposal',
            description: 'Descarta una propuesta en staging (sin tocar disco) para reintentar con otra instrucción.',
            parameters: {
                type: 'object',
                properties: {
                    proposalId: { type: 'string', description: 'ID de la propuesta a descartar.' },
                    reason: { type: 'string', description: 'Motivo del rechazo (opcional).' }
                },
                required: ['proposalId']
            }
        }
    }
];

export async function executeToolCall(
    toolName: string,
    args: any,
    ollamaService: OllamaService
): Promise<ToolExecutionResult> {
    try {
        switch (toolName) {
            case 'readFile':
                return await FileTools.readFile(args);
            case 'createFile':
                return await FileTools.createFile(args);
            case 'editFile':
                return await FileTools.editFile(args);
            case 'restoreBackup':
                return await FileTools.restoreBackup(args);
            case 'listDirectory':
                return await FileTools.listDirectory(args);
            case 'runCommand':
                return await TerminalTools.runCommand(args);
            case 'analyzeActiveTerminal':
                return await TerminalTools.analyzeActiveTerminal();
            case 'semanticSearch':
                return await RAGTools.semanticSearch(args.query, ollamaService, args.topK || 4);
            case 'generateProjectContext':
                return await FileTools.generateProjectContext();
            case 'getWorkspaceDiagnostics':
                return DiagnosticTools.getWorkspaceDiagnostics(args);
            case 'delegate_to_freellm_worker':
            case 'approve_worker_proposal':
            case 'reject_worker_proposal': {
                const { dispatchBridgeTool } = await import('../services/mcpBridgeServer');
                return await dispatchBridgeTool(toolName, (args && typeof args === 'object') ? args : {});
            }
            case 'consultSkill': {
                const { SkillCatalogService } = await import('../services/skillCatalogService');
                const catalog = await SkillCatalogService.getInstance().indexSkills();
                const query = (args.skillNameOrKeyword || '').toLowerCase();
                const found = catalog.find(s => s.id.toLowerCase().includes(query) || s.name.toLowerCase().includes(query) || s.tags.some(t => t.includes(query)));
                if (!found) {
                    return {
                        toolName,
                        success: false,
                        output: `No se encontró ninguna skill coincidente con '${query}'. Skills disponibles: ${catalog.slice(0, 15).map(s => s.id).join(', ')}...`
                    };
                }
                const fs = await import('fs');
                const content = await fs.promises.readFile(found.filePath, 'utf8');
                return {
                    toolName,
                    success: true,
                    output: `### Skill: ${found.name}\n${content.substring(0, 3000)}`
                };
            }
            default:
                return {
                    toolName,
                    success: false,
                    output: `Herramienta desconocida '${toolName}'. Herramientas disponibles: ${AGENT_TOOLS.map(t => t.function.name).join(', ')}`
                };
        }
    } catch (error: any) {
        return {
            toolName,
            success: false,
            output: `Excepción fatal al ejecutar ${toolName}: ${error.message}`
        };
    }
}

export { FileTools, TerminalTools, RAGTools, DiagnosticTools };


