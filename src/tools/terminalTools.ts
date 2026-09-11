import * as vscode from 'vscode';
import * as cp from 'child_process';
import { ToolExecutionResult } from '../types';

export class TerminalTools {
    /**
     * Ejecuta un comando en la terminal asíncronamente capturando stdout y stderr
     */
    public static async runCommand(args: { command: string; cwd?: string; timeoutMs?: number }): Promise<ToolExecutionResult> {
        return new Promise((resolve) => {
            let workingDir = process.cwd();
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                workingDir = workspaceFolders[0].uri.fsPath;
            }
            if (args.cwd) {
                workingDir = args.cwd;
            }

            const timeout = args.timeoutMs || 60000; // 60 segundos por defecto
            const startTime = Date.now();

            cp.exec(args.command, { cwd: workingDir, timeout: timeout, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                let output = '';

                if (stdout && stdout.trim()) {
                    output += `STDOUT:\n${stdout.trim()}\n\n`;
                }
                if (stderr && stderr.trim()) {
                    output += `STDERR:\n${stderr.trim()}\n\n`;
                }

                if (error) {
                    output += `ERROR [Código: ${error.code || 'Desconocido'}]: ${error.message}\n`;
                    resolve({
                        toolName: 'runCommand',
                        success: false,
                        output: `Comando falló (${duration}s):\n${output.trim()}`
                    });
                } else {
                    resolve({
                        toolName: 'runCommand',
                        success: true,
                        output: output.trim() ? `Comando ejecutado con éxito (${duration}s):\n${output.trim()}` : `Comando completado exitosamente sin salida (${duration}s).`
                    });
                }
            });
        });
    }

    /**
     * Captura el buffer visible/reciente de la terminal activa para diagnóstico automático de errores
     */
    public static async analyzeActiveTerminal(): Promise<ToolExecutionResult> {
        try {
            // Comprobar si hay terminales abiertas
            if (vscode.window.terminals.length === 0) {
                return {
                    toolName: 'analyzeActiveTerminal',
                    success: false,
                    output: 'No hay ninguna terminal abierta en VS Code actualmente.'
                };
            }

            // Seleccionar todo y copiar al portapapeles
            await vscode.commands.executeCommand('workbench.action.terminal.selectAll');
            await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
            await vscode.commands.executeCommand('workbench.action.terminal.clearSelection');

            // Pausa breve para sincronización con el portapapeles del sistema
            await new Promise((resolve) => setTimeout(resolve, 350));

            const clipboardText = await vscode.env.clipboard.readText();

            if (!clipboardText || clipboardText.trim() === '') {
                return {
                    toolName: 'analyzeActiveTerminal',
                    success: false,
                    output: 'La terminal activa está vacía o no tiene texto seleccionable.'
                };
            }

            // Tomar los últimos 3000 caracteres para no saturar el contexto del modelo
            const maxChars = 3000;
            const recentText = clipboardText.length > maxChars
                ? '... [Fragmento anterior omitido]\n' + clipboardText.substring(clipboardText.length - maxChars)
                : clipboardText;

            return {
                toolName: 'analyzeActiveTerminal',
                success: true,
                output: `Captura de la Terminal Activa:\n\`\`\`text\n${recentText}\n\`\`\``
            };
        } catch (error: any) {
            return {
                toolName: 'analyzeActiveTerminal',
                success: false,
                output: `Excepción al capturar la terminal: ${error.message}`
            };
        }
    }
}
