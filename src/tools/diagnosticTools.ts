import * as vscode from 'vscode';
import * as path from 'path';
import { LSPDiagnostic, ToolExecutionResult } from '../types';

export class DiagnosticTools {
    /**
     * Consulta el panel de diagnósticos nativo de VS Code (errores de compilación, TypeScript, linters)
     */
    public static getWorkspaceDiagnostics(args?: { severity?: 'Error' | 'Warning' | 'All'; targetFile?: string }): ToolExecutionResult {
        try {
            const allDiagnostics = vscode.languages.getDiagnostics();
            const results: LSPDiagnostic[] = [];
            const filterSeverity = args?.severity || 'All';
            const targetFile = args?.targetFile ? path.resolve(args.targetFile) : undefined;

            for (const [uri, diagList] of allDiagnostics) {
                const fsPath = uri.fsPath;
                if (targetFile && path.resolve(fsPath) !== targetFile) {
                    continue;
                }

                for (const d of diagList) {
                    let severityStr: LSPDiagnostic['severity'] = 'Information';
                    if (d.severity === vscode.DiagnosticSeverity.Error) {
                        severityStr = 'Error';
                    } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
                        severityStr = 'Warning';
                    } else if (d.severity === vscode.DiagnosticSeverity.Information) {
                        severityStr = 'Information';
                    } else if (d.severity === vscode.DiagnosticSeverity.Hint) {
                        severityStr = 'Hint';
                    }

                    if (filterSeverity === 'Error' && severityStr !== 'Error') {
                        continue;
                    }
                    if (filterSeverity === 'Warning' && (severityStr !== 'Error' && severityStr !== 'Warning')) {
                        continue;
                    }

                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    const relPath = workspaceFolders && workspaceFolders.length > 0
                        ? path.relative(workspaceFolders[0].uri.fsPath, fsPath)
                        : path.basename(fsPath);

                    results.push({
                        filePath: relPath,
                        line: d.range.start.line + 1,
                        column: d.range.start.character + 1,
                        severity: severityStr,
                        message: d.message,
                        source: d.source || 'LSP'
                    });
                }
            }

            if (results.length === 0) {
                return {
                    toolName: 'getWorkspaceDiagnostics',
                    success: true,
                    output: '✅ No se encontraron errores ni advertencias activas en el workspace.'
                };
            }

            let output = `Diagnósticos del Workspace (${results.length} problemas encontrados):\n\n`;
            results.slice(0, 30).forEach((item, idx) => {
                const icon = item.severity === 'Error' ? '🔴' : (item.severity === 'Warning' ? '🟡' : 'ℹ️');
                output += `${icon} [${idx + 1}] [${item.severity}] ${item.filePath}:${item.line}:${item.column} (${item.source})\n`;
                output += `   Mensaje: ${item.message}\n\n`;
            });

            if (results.length > 30) {
                output += `... y ${results.length - 30} diagnósticos adicionales omitidos.\n`;
            }

            return {
                toolName: 'getWorkspaceDiagnostics',
                success: true,
                output: output.trim()
            };
        } catch (error: any) {
            return {
                toolName: 'getWorkspaceDiagnostics',
                success: false,
                output: `Error al leer diagnósticos del workspace: ${error.message}`
            };
        }
    }

    /**
     * Retorna una lista compacta de diagnósticos para inyección en el prompt o autocompletado @problems
     */
    public static getDiagnosticsSummary(): string {
        const result = this.getWorkspaceDiagnostics({ severity: 'Error' });
        return result.output;
    }
}
