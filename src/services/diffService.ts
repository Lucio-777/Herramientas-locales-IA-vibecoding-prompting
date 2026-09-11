import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class DiffService implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'vibecoding-diff';
    private static instance: DiffService;
    private virtualDocs = new Map<string, string>();
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public readonly onDidChange = this._onDidChange.event;

    public static getInstance(): DiffService {
        if (!DiffService.instance) {
            DiffService.instance = new DiffService();
        }
        return DiffService.instance;
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.virtualDocs.get(uri.toString()) || '';
    }

    /**
     * Abre una vista de diferencias nativa en VS Code (Split Diff View)
     */
    public async showNativeDiff(filePath: string, oldContent: string, newContent: string, title?: string): Promise<void> {
        try {
            const fileName = path.basename(filePath);
            const originalUri = vscode.Uri.parse(`${DiffService.scheme}:/original/${fileName}?ts=${Date.now()}`);
            const modifiedUri = vscode.Uri.parse(`${DiffService.scheme}:/modified/${fileName}?ts=${Date.now()}`);

            this.virtualDocs.set(originalUri.toString(), oldContent);
            this.virtualDocs.set(modifiedUri.toString(), newContent);

            this._onDidChange.fire(originalUri);
            this._onDidChange.fire(modifiedUri);

            const tabTitle = title || `VibeCoding Diff: ${fileName}`;
            await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, tabTitle, {
                preview: true,
                preserveFocus: false
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error al abrir vista de diferencias: ${error.message}`);
        }
    }

    /**
     * Revierte un cambio en un archivo real
     */
    public async revertFile(filePath: string, oldContent: string): Promise<boolean> {
        try {
            await fs.promises.writeFile(filePath, oldContent, 'utf8');
            vscode.window.showInformationMessage(`Cambio revertido en '${path.basename(filePath)}'.`);
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error al revertir archivo: ${error.message}`);
            return false;
        }
    }
}
