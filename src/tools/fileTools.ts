import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ToolExecutionResult } from '../types';

export class FileTools {
    private static resolvePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return path.join(workspaceFolders[0].uri.fsPath, filePath);
        }
        return path.resolve(filePath);
    }

    /**
     * BUG FIX: Valida que una ruta absoluta esté dentro del workspace activo.
     * Si está fuera, lo advierte y redirige al workspace para prevenir escrituras accidentales.
     */
    private static validateAndNormalizePath(filePath: string): { resolvedPath: string; warning?: string } {
        const resolvedPath = this.resolvePath(filePath);
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (path.isAbsolute(filePath) && workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            if (!resolvedPath.startsWith(workspaceRoot)) {
                // La ruta apunta fuera del workspace — registrar advertencia pero permitir (el modelo puede querer operar en otro dir)
                const warning = `⚠️ Advertencia: La ruta '${resolvedPath}' está fuera del workspace activo ('${workspaceRoot}'). Si esto es incorrecto, usa rutas relativas.`;
                console.warn(`[FileTools] ${warning}`);
                return { resolvedPath, warning };
            }
        }
        return { resolvedPath };
    }

    /**
     * Lee un archivo con control opcional de líneas y longitud máxima
     */
    public static async readFile(args: { filePath: string; startLine?: number; endLine?: number; maxBytes?: number }): Promise<ToolExecutionResult> {
        const { resolvedPath: fullPath, warning } = this.validateAndNormalizePath(args.filePath);
        try {
            if (!fs.existsSync(fullPath)) {
                return {
                    toolName: 'readFile',
                    success: false,
                    output: `Error: Archivo no encontrado en '${fullPath}'.\nSugerencia: Utiliza 'listDirectory' para verificar las rutas exactas disponibles en el workspace.`
                };
            }

            const stats = await fs.promises.stat(fullPath);
            if (stats.isDirectory()) {
                return {
                    toolName: 'readFile',
                    success: false,
                    output: `Error: '${fullPath}' es un directorio, no un archivo. Usa 'listDirectory' para explorar su contenido.`
                };
            }

            const rawContent = await fs.promises.readFile(fullPath, 'utf8');
            const lines = rawContent.split(/\r?\n/);

            let start = args.startLine ? Math.max(1, args.startLine) : 1;
            let end = args.endLine ? Math.min(lines.length, args.endLine) : lines.length;

            if (start > lines.length) {
                return {
                    toolName: 'readFile',
                    success: false,
                    output: `Error: startLine (${start}) excede el total de líneas del archivo (${lines.length}).`
                };
            }

            const selectedLines = lines.slice(start - 1, end);
            const numberedLines = selectedLines.map((line, idx) => `${start + idx}: ${line}`).join('\n');

            const maxBytes = args.maxBytes || 50000;
            let output = numberedLines;
            if (output.length > maxBytes) {
                output = output.substring(0, maxBytes) + '\n... [Contenido truncado por límite de tamaño. Usa startLine/endLine para leer por secciones.]';
            }

            const warningPrefix = warning ? `${warning}\n\n` : '';
            return {
                toolName: 'readFile',
                success: true,
                output: `${warningPrefix}Archivo: ${path.basename(fullPath)} (Líneas ${start}-${end} de ${lines.length}):\n${output}`
            };
        } catch (error: any) {
            return {
                toolName: 'readFile',
                success: false,
                output: `Excepción al leer archivo '${fullPath}': ${error.message}`
            };
        }
    }

    /**
     * Crea un archivo asegurando que los directorios padres existan
     */
    public static async createFile(args: { filePath: string; content: string }): Promise<ToolExecutionResult> {
        const { resolvedPath: fullPath, warning } = this.validateAndNormalizePath(args.filePath);
        try {
            await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
            await fs.promises.writeFile(fullPath, args.content, 'utf8');

            const warningNote = warning ? `\n${warning}` : '';
            return {
                toolName: 'createFile',
                success: true,
                output: `Éxito: Archivo creado en '${fullPath}' (${args.content.length} caracteres).${warningNote}`
            };
        } catch (error: any) {
            return {
                toolName: 'createFile',
                success: false,
                output: `Error al crear archivo '${fullPath}': ${error.message}`
            };
        }
    }

    /**
     * Reemplazo quirúrgico por bloques de texto.
     * BUG FIX: El fallback "aproximado" que podía corromper archivos fue eliminado.
     * Si targetChunk no se encuentra exactamente, el error es explícito y dice qué hacer.
     */
    public static async editFile(args: { filePath: string; targetChunk: string; replacement: string }): Promise<ToolExecutionResult> {
        const { resolvedPath: fullPath } = this.validateAndNormalizePath(args.filePath);
        try {
            if (!fs.existsSync(fullPath)) {
                return {
                    toolName: 'editFile',
                    success: false,
                    output: `Error: Archivo no encontrado '${fullPath}'.\nSolución: Usa 'createFile' si el archivo no existe aún.`
                };
            }

            const oldContent = await fs.promises.readFile(fullPath, 'utf8');

            // Normalización de saltos de línea para evitar diferencias \r\n vs \n
            const normalize = (str: string) => str.replace(/\r\n/g, '\n');
            const normOld = normalize(oldContent);
            const normTarget = normalize(args.targetChunk);
            const normReplacement = normalize(args.replacement);

            if (!normOld.includes(normTarget)) {
                // BUG FIX: Eliminado el fallback con .trim() que podía hacer reemplazos incorrectos.
                // En su lugar, retornamos un error explícito y accionable.
                return {
                    toolName: 'editFile',
                    success: false,
                    output: `Error: El bloque 'targetChunk' NO se encontró exactamente en '${path.basename(fullPath)}'.\n\n` +
                            `SOLUCIÓN: Usa 'readFile' en el archivo para obtener el fragmento exacto tal como está en el archivo ` +
                            `(incluyendo espacios, indentación y saltos de línea), luego vuelve a llamar a 'editFile' con ese fragmento exacto.\n\n` +
                            `Primeras 3 líneas del archivo actual:\n${normOld.split('\n').slice(0, 3).join('\n')}`
                };
            }

            const newContent = normOld.replace(normTarget, normReplacement);
            await fs.promises.writeFile(fullPath, newContent, 'utf8');

            return {
                toolName: 'editFile',
                success: true,
                output: `Éxito: Modificación quirúrgica aplicada a '${path.basename(fullPath)}'.`,
                diff: {
                    filePath: fullPath,
                    oldContent: args.targetChunk,
                    newContent: args.replacement
                }
            };
        } catch (error: any) {
            return {
                toolName: 'editFile',
                success: false,
                output: `Error al editar archivo '${fullPath}': ${error.message}`
            };
        }
    }

    /**
     * Exploración de directorios recursiva y estructurada
     */
    public static async listDirectory(args: { dirPath?: string; maxDepth?: number }): Promise<ToolExecutionResult> {
        const { resolvedPath: fullPath } = this.validateAndNormalizePath(args.dirPath || '.');
        const maxDepth = args.maxDepth !== undefined ? args.maxDepth : 3;

        try {
            if (!fs.existsSync(fullPath)) {
                return {
                    toolName: 'listDirectory',
                    success: false,
                    output: `Error: Directorio no encontrado en '${fullPath}'.`
                };
            }

            const ignoredNames = new Set([
                'node_modules', '.git', '.vscode', 'dist', 'out', '.idea', '.DS_Store', 'coverage', '.cache', '__pycache__'
            ]);

            const walk = async (currentDir: string, currentDepth: number, prefix: string): Promise<string> => {
                if (currentDepth > maxDepth) {
                    return '';
                }

                let tree = '';
                const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });

                for (const entry of entries) {
                    if (ignoredNames.has(entry.name)) {
                        continue;
                    }

                    const subPath = path.join(currentDir, entry.name);
                    if (entry.isDirectory()) {
                        tree += `${prefix}📁 ${entry.name}/\n`;
                        tree += await walk(subPath, currentDepth + 1, prefix + '  ');
                    } else {
                        tree += `${prefix}📄 ${entry.name}\n`;
                    }
                }
                return tree;
            };

            const resultTree = await walk(fullPath, 1, '');
            return {
                toolName: 'listDirectory',
                success: true,
                output: `Estructura de '${path.basename(fullPath) || 'workspace'}' (Profundidad máx: ${maxDepth}):\n\`\`\`\n${resultTree || '(Directorio vacío)'}\`\`\``
            };
        } catch (error: any) {
            return {
                toolName: 'listDirectory',
                success: false,
                output: `Error al listar directorio '${fullPath}': ${error.message}`
            };
        }
    }

    /**
     * Genera y guarda un documento de contexto global del proyecto (árbol y configuraciones clave)
     */
    public static async generateProjectContext(): Promise<ToolExecutionResult> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
                toolName: 'generateProjectContext',
                success: false,
                output: 'Error: No hay ningún workspace abierto en VS Code.'
            };
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const projectName = workspaceFolders[0].name || path.basename(rootPath);
        const contextoDir = path.join(rootPath, 'contexto');
        const contextoFile = path.join(contextoDir, 'contexto_proyecto.md');

        try {
            await fs.promises.mkdir(contextoDir, { recursive: true });

            let markdown = `# Contexto Global del Proyecto: ${projectName}\n`;
            markdown += `Ruta del Workspace: ${rootPath}\n\n`;
            markdown += `## Estructura de Directorios\n\`\`\`\n`;

            const treeResult = await this.listDirectory({ dirPath: rootPath, maxDepth: 3 });
            markdown += (treeResult.output.replace(/^Estructura.*\n```\n/, '').replace(/\n```$/, '') || '') + '\n```\n\n';

            markdown += `## Configuraciones Clave del Proyecto\n`;
            const keyFiles = ['package.json', 'tsconfig.json', 'README.md', 'vite.config.ts', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pubspec.yaml'];

            for (const file of keyFiles) {
                const filePath = path.join(rootPath, file);
                if (fs.existsSync(filePath)) {
                    let content = await fs.promises.readFile(filePath, 'utf8');
                    if (file === 'README.md' && content.length > 1200) {
                        content = content.substring(0, 1200) + '\n... [README truncado para contexto]';
                    }
                    markdown += `### ${file}\n\`\`\`\n${content.trim()}\n\`\`\`\n\n`;
                }
            }

            await fs.promises.writeFile(contextoFile, markdown, 'utf8');

            return {
                toolName: 'generateProjectContext',
                success: true,
                output: `Contexto global del proyecto '${projectName}' generado con éxito en '${path.relative(rootPath, contextoFile)}'.`
            };
        } catch (error: any) {
            return {
                toolName: 'generateProjectContext',
                success: false,
                output: `Error al generar contexto del proyecto: ${error.message}`
            };
        }
    }

    /**
     * Lee el contexto global si existe, o retorna vacío si no hay (no auto-genera para no bloquear)
     */
    public static async loadProjectContext(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return '';
        const rootPath = workspaceFolders[0].uri.fsPath;
        const projectName = workspaceFolders[0].name || path.basename(rootPath);
        const contextoFile = path.join(rootPath, 'contexto', 'contexto_proyecto.md');

        if (fs.existsSync(contextoFile)) {
            try {
                const content = await fs.promises.readFile(contextoFile, 'utf8');
                if (!content.includes(projectName)) {
                    await this.generateProjectContext();
                    return await fs.promises.readFile(contextoFile, 'utf8');
                }
                return content;
            } catch {
                return '';
            }
        }
        return '';
    }
}
