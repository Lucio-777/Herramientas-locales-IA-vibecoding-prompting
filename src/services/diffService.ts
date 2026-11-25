import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PendingProposal } from '../types';

export class DiffService implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'vibecoding-diff';
    private static instance: DiffService;
    private virtualDocs = new Map<string, string>();
    private pendingProposals = new Map<string, PendingProposal>();
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

    /**
     * Crea una propuesta pendiente de auditoría en memoria (Opción B: Supervisión Estricta)
     * No escribe a disco hasta recibir aprobación explícita.
     */
    public async createProposal(
        filePath: string,
        proposedContent: string,
        metadata?: Record<string, any>
    ): Promise<PendingProposal> {
        let originalContent = '';
        try {
            if (fs.existsSync(filePath)) {
                originalContent = await fs.promises.readFile(filePath, 'utf8');
            }
        } catch {
            originalContent = '';
        }

        const unifiedDiff = this.generateUnifiedDiff(filePath, originalContent, proposedContent);
        const id = 'prop_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

        const proposal: PendingProposal = {
            id,
            filePath,
            originalContent,
            proposedContent,
            unifiedDiff,
            timestamp: Date.now(),
            status: 'pending',
            metadata
        };

        this.pendingProposals.set(id, proposal);
        return proposal;
    }

    public getProposal(proposalId: string): PendingProposal | undefined {
        return this.pendingProposals.get(proposalId);
    }

    public listPendingProposals(): PendingProposal[] {
        return Array.from(this.pendingProposals.values()).filter(p => p.status === 'pending');
    }

    /**
     * Aplica la propuesta a disco tras la auditoría del Agente Jefe
     */
    public async applyProposal(
        proposalId: string
    ): Promise<{ success: boolean; filePath: string; error?: string }> {
        const proposal = this.pendingProposals.get(proposalId);
        if (!proposal) {
            return { success: false, filePath: '', error: `Propuesta '${proposalId}' no encontrada.` };
        }

        try {
            const dir = path.dirname(proposal.filePath);
            if (!fs.existsSync(dir)) {
                await fs.promises.mkdir(dir, { recursive: true });
            }
            await fs.promises.writeFile(proposal.filePath, proposal.proposedContent, 'utf8');
            proposal.status = 'approved';
            return { success: true, filePath: proposal.filePath };
        } catch (error: any) {
            return { success: false, filePath: proposal.filePath, error: error.message || String(error) };
        }
    }

    /**
     * Rechaza y descarta una propuesta sin tocar el disco
     */
    public rejectProposal(proposalId: string): boolean {
        const proposal = this.pendingProposals.get(proposalId);
        if (!proposal) {
            return false;
        }
        proposal.status = 'rejected';
        this.pendingProposals.delete(proposalId);
        return true;
    }

    /**
     * Generador unificado de diffs estándar (LCS puro sin binarios externos)
     */
    public generateUnifiedDiff(filePath: string, oldContent: string, newContent: string): string {
        const oldLines = oldContent ? oldContent.split('\n') : [];
        const newLines = newContent ? newContent.split('\n') : [];

        const diffLines: string[] = [];
        diffLines.push(`--- a/${filePath.replace(/\\/g, '/')}`);
        diffLines.push(`+++ b/${filePath.replace(/\\/g, '/')}`);

        const hunks = this.computeHunks(oldLines, newLines);
        if (hunks.length === 0) {
            diffLines.push('@@ -0,0 +0,0 @@ (Sin cambios detectados)');
            return diffLines.join('\n');
        }

        for (const hunk of hunks) {
            diffLines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
            for (const line of hunk.lines) {
                diffLines.push(line);
            }
        }

        return diffLines.join('\n');
    }

    private computeHunks(
        oldLines: string[],
        newLines: string[]
    ): Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }> {
        const hunks: Array<{ oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }> = [];
        const lcs = this.computeLCS(oldLines, newLines);
        const oldMarkers = new Array<boolean>(oldLines.length).fill(false);
        const newMarkers = new Array<boolean>(newLines.length).fill(false);

        for (let i = 0; i < lcs.length; i++) {
            const [oi, ni] = lcs[i];
            oldMarkers[oi] = true;
            newMarkers[ni] = true;
        }

        let i = 0;
        let j = 0;
        while (i < oldLines.length || j < newLines.length) {
            if (i < oldLines.length && j < newLines.length && oldMarkers[i] && newMarkers[j]) {
                i++;
                j++;
                continue;
            }

            const oldStart = i;
            const newStart = j;
            const lines: string[] = [];

            while (i < oldLines.length && !oldMarkers[i]) {
                lines.push('-' + oldLines[i]);
                i++;
            }

            while (j < newLines.length && !newMarkers[j]) {
                lines.push('+' + newLines[j]);
                j++;
            }

            if (lines.length > 0) {
                hunks.push({
                    oldStart: oldStart + 1,
                    oldCount: i - oldStart,
                    newStart: newStart + 1,
                    newCount: j - newStart,
                    lines
                });
            }
        }

        return hunks;
    }

    private computeLCS(oldLines: string[], newLines: string[]): Array<[number, number]> {
        const m = oldLines.length;
        const n = newLines.length;
        const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = m - 1; i >= 0; i--) {
            for (let j = n - 1; j >= 0; j--) {
                if (oldLines[i] === newLines[j]) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        const result: Array<[number, number]> = [];
        let i = 0;
        let j = 0;
        while (i < m && j < n) {
            if (oldLines[i] === newLines[j]) {
                result.push([i, j]);
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                i++;
            } else {
                j++;
            }
        }

        return result;
    }
}
