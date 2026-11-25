import * as vscode from 'vscode';
import * as cp from 'child_process';
import { ToolExecutionResult } from '../types';

export class TerminalTools {
    private static isDangerousCommand(cmd: string): { dangerous: boolean; reason?: string } {
        const lower = cmd.toLowerCase().trim();
        const dangerousPatterns = [
            { regex: /\brm\s+-(?:r|f|rf|fr)\s+(?:\/|~|\.\.|\*)/, reason: 'Eliminación recursiva masiva o de raíz' },
            { regex: /\brmdir\s+\/(?:s|q)\s+[a-z]:\\/i, reason: 'Eliminación forzada de unidad de disco' },
            { regex: /\bdel\s+(?:\/[a-z\s]+)*(?:[a-z]:\\|\*)/i, reason: 'Eliminación masiva de archivos en Windows' },
            { regex: /\bformat\s+[a-z]:/i, reason: 'Formateo de unidad' },
            { regex: /\bgit\s+reset\s+--hard\b/, reason: 'Pérdida irreversible de cambios en Git' },
            { regex: /\bgit\s+clean\s+-(?:f|fd|fdx|xdf)\b/, reason: 'Eliminación irreversible de archivos no rastreados' },
            { regex: /\bgit\s+push\s+.*--force\b/, reason: 'Sobrescritura forzada en repositorio remoto' },
            { regex: /\b(?:shutdown|reboot|init\s+0)\b/, reason: 'Apagado o reinicio del sistema' },
            { regex: /\b(?:mkfs|dd\s+if=)\b/, reason: 'Sobrescritura de disco a bajo nivel' },
            { regex: /\bdrop\s+database\b/i, reason: 'Destrucción de base de datos' }
        ];

        for (const p of dangerousPatterns) {
            if (p.regex.test(lower)) {
                return { dangerous: true, reason: p.reason };
            }
        }
        return { dangerous: false };
    }

    /**
     * Ejecuta un comando en la terminal asíncronamente capturando stdout y stderr con filtro de seguridad
     */
    public static async runCommand(args: { command: string; cwd?: string; timeoutMs?: number }): Promise<ToolExecutionResult> {
        // Validación de seguridad previa
        const safetyCheck = this.isDangerousCommand(args.command);
        if (safetyCheck.dangerous) {
            return {
                toolName: 'runCommand',
                success: false,
                output: `⚠️ BLOQUEO DE SEGURIDAD VIBECODING: El comando '${args.command}' fue cancelado porque contiene patrones potencialmente destructivos (${safetyCheck.reason}). Por favor ejecuta este comando manualmente en la terminal integrada si realmente lo necesitas.`
            };
        }

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
