import * as vscode from 'vscode';
import { ChatViewProvider } from './chatViewProvider';
import { DiffService } from './services/diffService';
import { QuotaTracker } from './services/quotaTracker';

export function activate(context: vscode.ExtensionContext) {
    console.log('[VibeCoding Local] Extensión activada con soporte para Ollama (Qwen, DeepSeek, Llama Vision, Nomic) y Filtro Cloud.');

    // Inicializar rastreador estricto de cuotas en la nube
    QuotaTracker.getInstance().init(context);

    // Registrar proveedor de diffs virtuales
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(
            DiffService.scheme,
            DiffService.getInstance()
        )
    );

    // Registrar el proveedor del panel lateral
    const provider = new ChatViewProvider(context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider)
    );

    // Comando para abrir o iniciar el agente
    const startAgentCommand = vscode.commands.registerCommand('vibe-coding-local.startAgent', async () => {
        await vscode.commands.executeCommand('workbench.view.extension.vibe-coding-local-container');
        vscode.window.showInformationMessage('VibeCoding Local Agent activo en el panel lateral.');
    });
    context.subscriptions.push(startAgentCommand);

    // Comando para limpiar chat
    const clearChatCommand = vscode.commands.registerCommand('vibe-coding-local.clearChat', async () => {
        await provider.clearChat();
        vscode.window.showInformationMessage('Conversación de VibeCoding reiniciada.');
    });
    context.subscriptions.push(clearChatCommand);

    // Comando para ver reporte de cuotas en la nube
    const showQuotaCommand = vscode.commands.registerCommand('vibe-coding-local.showQuotaReport', () => {
        const report = QuotaTracker.getInstance().getUsageReport();
        vscode.window.showInformationMessage(`📊 Cuota Cloud de VibeCoding:\n• Gemini (5% máx): ${report.gemini}\n• Groq (10% máx): ${report.groq}`);
    });
    context.subscriptions.push(showQuotaCommand);

    // Comando de Menú Contextual: Explicar Código
    const explainCodeCommand = vscode.commands.registerCommand('vibe-coding-local.explainCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('Selecciona un fragmento de código para explicar.');
            return;
        }
        const selectedText = editor.document.getText(editor.selection);
        await vscode.commands.executeCommand('workbench.view.extension.vibe-coding-local-container');
        await provider.triggerDirectAction(`Explica en detalle este código seleccionado de ${editor.document.fileName}:\n\`\`\`\n${selectedText}\n\`\`\``);
    });
    context.subscriptions.push(explainCodeCommand);

    // Comando de Menú Contextual: Refactorizar Código
    const refactorCodeCommand = vscode.commands.registerCommand('vibe-coding-local.refactorCode', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.selection.isEmpty) {
            vscode.window.showWarningMessage('Selecciona un fragmento de código para refactorizar.');
            return;
        }
        const selectedText = editor.document.getText(editor.selection);
        await vscode.commands.executeCommand('workbench.view.extension.vibe-coding-local-container');
        await provider.triggerDirectAction(`Refactoriza y optimiza el siguiente código seleccionado de ${editor.document.fileName}, manteniendo su comportamiento pero mejorando legibilidad y rendimiento:\n\`\`\`\n${selectedText}\n\`\`\``);
    });
    context.subscriptions.push(refactorCodeCommand);

    // Comando de Menú Contextual: Diagnosticar Errores con DeepSeek R1
    const fixDiagnosticsCommand = vscode.commands.registerCommand('vibe-coding-local.fixDiagnostics', async () => {
        const editor = vscode.window.activeTextEditor;
        await vscode.commands.executeCommand('workbench.view.extension.vibe-coding-local-container');
        const fileParam = editor ? ` para el archivo ${editor.document.fileName}` : '';
        await provider.triggerDirectAction(`Analiza los diagnósticos y errores del workspace${fileParam} usando la herramienta getWorkspaceDiagnostics y propón un plan de resolución paso a paso.`);
    });
    context.subscriptions.push(fixDiagnosticsCommand);
}

export function deactivate() {
    console.log('[VibeCoding Local] Extensión desactivada.');
}
