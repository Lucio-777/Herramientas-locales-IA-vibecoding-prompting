import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class RulesService {
    private static candidateFiles = [
        path.join('.vibecoding', 'rules.md'),
        '.cursorrules',
        'AGENTS.md',
        'GEMINI.md',
        '.rules.md'
    ];

    /**
     * Carga las reglas o convenciones personalizadas definidas por el usuario en su workspace
     */
    public static async loadProjectRules(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return '';

        const rootPath = workspaceFolders[0].uri.fsPath;
        let rulesCombined = '';

        for (const candidate of this.candidateFiles) {
            const candidatePath = path.join(rootPath, candidate);
            if (fs.existsSync(candidatePath)) {
                try {
                    const content = await fs.promises.readFile(candidatePath, 'utf8');
                    if (content.trim()) {
                        rulesCombined += `\n--- [REGLAS DEL PROYECTO (${candidate})] ---\n${content.trim()}\n`;
                    }
                } catch (e: any) {
                    console.warn(`Error al leer archivo de reglas ${candidate}:`, e.message);
                }
            }
        }

        return rulesCombined.trim();
    }
}
