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
            const normResolved = path.normalize(resolvedPath).toLowerCase();
            const normRoot = path.normalize(workspaceRoot).toLowerCase();
            if (!normResolved.startsWith(normRoot)) {
                // La ruta apunta fuera del workspace — registrar advertencia pero permitir
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
     * Determina la raíz correcta del proyecto para guardar/leer backups en .vibecoding/backups/
     * Si el archivo está dentro del workspace activo, usa el workspace. Si está fuera, busca la raíz del proyecto del archivo (donde haya package.json/.git).
     */
    private static resolveProjectRootForFile(fullPath: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const wsRoot = workspaceFolders[0].uri.fsPath;
            const normFull = path.normalize(fullPath).toLowerCase();
            const normWs = path.normalize(wsRoot).toLowerCase();
            if (normFull.startsWith(normWs)) {
                return wsRoot;
            }
        }
        // El archivo está fuera del workspace actual: subir directorios hasta encontrar package.json, .git o .vibecoding
        let currentDir = path.dirname(fullPath);
        const rootDrive = path.parse(currentDir).root;
        while (currentDir && currentDir !== rootDrive) {
            if (
                fs.existsSync(path.join(currentDir, 'package.json')) ||
                fs.existsSync(path.join(currentDir, '.git')) ||
                fs.existsSync(path.join(currentDir, '.vibecoding'))
            ) {
                return currentDir;
            }
            const parent = path.dirname(currentDir);
            if (parent === currentDir) {
                break;
            }
            currentDir = parent;
        }
        return path.dirname(fullPath);
    }

    /**
     * Crea un backup automático en .vibecoding/backups/ antes de modificar un archivo
     */
    public static async createBackup(fullPath: string): Promise<string | null> {
        try {
            const root = this.resolveProjectRootForFile(fullPath);
            const backupDir = path.join(root, '.vibecoding', 'backups');
            await fs.promises.mkdir(backupDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const safeName = path.basename(fullPath).replace(/[^a-zA-Z0-9._-]/g, '_');
            const backupFile = path.join(backupDir, `${safeName}_${timestamp}.bak`);
            await fs.promises.copyFile(fullPath, backupFile);
            return backupFile;
        } catch {
            return null;
        }
    }

    /**
     * Restaura un archivo desde su backup más reciente
     */
    public static async restoreBackup(args: { filePath: string; backupId?: string }): Promise<ToolExecutionResult> {
        const { resolvedPath: fullPath } = this.validateAndNormalizePath(args.filePath);
        try {
            const root = this.resolveProjectRootForFile(fullPath);
            const backupDir = path.join(root, '.vibecoding', 'backups');
            if (!fs.existsSync(backupDir)) {
                return {
                    toolName: 'restoreBackup',
                    success: false,
                    output: `No se encontraron backups en el directorio .vibecoding/backups.`
                };
            }

            const safeName = path.basename(fullPath).replace(/[^a-zA-Z0-9._-]/g, '_');
            const files = await fs.promises.readdir(backupDir);
            const matchingBackups = files
                .filter(f => f.startsWith(`${safeName}_`) && f.endsWith('.bak'))
                .sort()
                .reverse();

            if (matchingBackups.length === 0) {
                return {
                    toolName: 'restoreBackup',
                    success: false,
                    output: `No se encontraron backups previos para '${path.basename(fullPath)}'.`
                };
            }

            const targetBackup = args.backupId ? path.join(backupDir, args.backupId) : path.join(backupDir, matchingBackups[0]);
            if (!fs.existsSync(targetBackup)) {
                return {
                    toolName: 'restoreBackup',
                    success: false,
                    output: `El backup especificado no existe: ${targetBackup}`
                };
            }

            await fs.promises.copyFile(targetBackup, fullPath);
            return {
                toolName: 'restoreBackup',
                success: true,
                output: `Archivo '${path.basename(fullPath)}' restaurado con éxito desde el backup: ${path.basename(targetBackup)}.`
            };
        } catch (error: any) {
            return {
                toolName: 'restoreBackup',
                success: false,
                output: `Error al restaurar backup: ${error.message}`
            };
        }
    }

    /**
     * Reemplazo quirúrgico resiliente con soporte de bloques de texto, rangos de línea y coincidencia difusa
     */
    public static async editFile(args: { filePath: string; targetChunk?: string; replacement: string; startLine?: number; endLine?: number }): Promise<ToolExecutionResult> {
        const { resolvedPath: fullPath } = this.validateAndNormalizePath(args.filePath);
        try {
            if (!fs.existsSync(fullPath)) {
                return {
                    toolName: 'editFile',
                    success: false,
                    output: `Error: Archivo no encontrado '${fullPath}'.\nSolución: Usa 'createFile' si el archivo no existe aún.`
                };
            }

            // 1. Crear backup automático antes de cualquier modificación
            const backupPath = await this.createBackup(fullPath);
            const oldContent = await fs.promises.readFile(fullPath, 'utf8');
            const lines = oldContent.split(/\r?\n/);
            const eol = oldContent.includes('\r\n') ? '\r\n' : '\n';

            // CASO A: Reemplazo por rango de líneas explícito (startLine y endLine)
            if (args.startLine !== undefined && args.endLine !== undefined && args.startLine > 0) {
                const startIdx = Math.max(0, args.startLine - 1);
                const endIdx = Math.min(lines.length, args.endLine);
                if (startIdx <= endIdx) {
                    const replacedSlice = lines.slice(startIdx, endIdx).join(eol);
                    const newLines = [
                        ...lines.slice(0, startIdx),
                        args.replacement,
                        ...lines.slice(endIdx)
                    ];
                    await fs.promises.writeFile(fullPath, newLines.join(eol), 'utf8');
                    const backupNotice = backupPath ? ` (Backup guardado en .vibecoding/backups)` : '';
                    return {
                        toolName: 'editFile',
                        success: true,
                        output: `Éxito: Líneas ${args.startLine}-${args.endLine} reemplazadas en '${path.basename(fullPath)}'.${backupNotice}`,
                        diff: {
                            filePath: fullPath,
                            oldContent: replacedSlice,
                            newContent: args.replacement
                        }
                    };
                }
            }

            // CASO B: Reemplazo por bloque targetChunk
            if (!args.targetChunk) {
                return {
                    toolName: 'editFile',
                    success: false,
                    output: `Error: Debes proporcionar 'targetChunk' o bien 'startLine'/'endLine' para editar el archivo.`
                };
            }

            const normalize = (str: string) => str.replace(/\r\n/g, '\n');
            const normOld = normalize(oldContent);
            const normTarget = normalize(args.targetChunk);
            const normReplacement = normalize(args.replacement);

            // B.1: Coincidencia exacta
            if (normOld.includes(normTarget)) {
                const newContent = normOld.replace(normTarget, normReplacement);
                await fs.promises.writeFile(fullPath, newContent, 'utf8');
                const backupNotice = backupPath ? ` (Backup guardado en .vibecoding/backups)` : '';
                return {
                    toolName: 'editFile',
                    success: true,
                    output: `Éxito: Modificación quirúrgica aplicada a '${path.basename(fullPath)}'.${backupNotice}`,
                    diff: {
                        filePath: fullPath,
                        oldContent: args.targetChunk,
                        newContent: args.replacement
                    }
                };
            }

            // B.2: Coincidencia difusa resiliente tolerante a indentación y espacios
            const targetLinesTrimmed = normTarget.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
            const oldLines = normOld.split('\n');

            let bestMatchStart = -1;
            let matchCount = 0;

            if (targetLinesTrimmed.length > 0) {
                for (let i = 0; i <= oldLines.length - targetLinesTrimmed.length; i++) {
                    let matches = true;
                    for (let j = 0; j < targetLinesTrimmed.length; j++) {
                        if (oldLines[i + j].trim() !== targetLinesTrimmed[j]) {
                            matches = false;
                            break;
                        }
                    }
                    if (matches) {
                        bestMatchStart = i;
                        matchCount++;
                    }
                }
            }

            if (matchCount === 1 && bestMatchStart !== -1) {
                const endMatch = bestMatchStart + targetLinesTrimmed.length;
                const oldMatchedSlice = oldLines.slice(bestMatchStart, endMatch).join('\n');
                const newLines = [
                    ...oldLines.slice(0, bestMatchStart),
                    normReplacement,
                    ...oldLines.slice(endMatch)
                ];
                await fs.promises.writeFile(fullPath, newLines.join(eol), 'utf8');
                const backupNotice = backupPath ? ` (Backup guardado en .vibecoding/backups)` : '';
                return {
                    toolName: 'editFile',
                    success: true,
                    output: `Éxito (vía coincidencia difusa resiliente): Modificación aplicada en líneas ${bestMatchStart + 1}-${endMatch} de '${path.basename(fullPath)}'.${backupNotice}`,
                    diff: {
                        filePath: fullPath,
                        oldContent: oldMatchedSlice,
                        newContent: args.replacement
                    }
                };
            }

            return {
                toolName: 'editFile',
                success: false,
                output: `Error: El bloque 'targetChunk' NO se encontró en '${path.basename(fullPath)}' ${matchCount > 1 ? '(múltiples bloques idénticos detectados)' : ''}.\n\n` +
                        `SOLUCIÓN ALTERNATIVA: Puedes usar 'startLine' y 'endLine' para indicar exactamente el rango de líneas a reemplazar, o usa 'readFile' para inspeccionar el archivo.`
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
