import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectProfile {
    projectName: string;
    rootPath: string;
    languages: string[];
    frameworks: string[];
    tags: string[];
    summary: string;
}

export class ProjectProfiler {
    /**
     * Analiza el espacio de trabajo activo y genera un perfil de stack tecnológico y etiquetas
     */
    public static async analyzeCurrentProject(): Promise<ProjectProfile> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return {
                projectName: 'Desconocido',
                rootPath: '',
                languages: [],
                frameworks: [],
                tags: ['general'],
                summary: 'Sin espacio de trabajo abierto'
            };
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const projectName = workspaceFolders[0].name || path.basename(rootPath);
        const languages = new Set<string>();
        const frameworks = new Set<string>();
        const tags = new Set<string>(['general', 'software-development']);

        try {
            // 1. Detección en Node.js / JavaScript / TypeScript
            const pkgPath = path.join(rootPath, 'package.json');
            if (fs.existsSync(pkgPath)) {
                languages.add('javascript');
                languages.add('typescript');
                tags.add('nodejs');
                tags.add('web');

                try {
                    const pkgContent = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
                    const allDeps = {
                        ...(pkgContent.dependencies || {}),
                        ...(pkgContent.devDependencies || {})
                    };

                    if (allDeps['react'] || allDeps['react-dom']) {
                        frameworks.add('react');
                        tags.add('frontend');
                    }
                    if (allDeps['vue']) {
                        frameworks.add('vue');
                        tags.add('frontend');
                    }
                    if (allDeps['@angular/core']) {
                        frameworks.add('angular');
                        tags.add('frontend');
                    }
                    if (allDeps['next']) {
                        frameworks.add('nextjs');
                        tags.add('fullstack');
                    }
                    if (allDeps['express'] || allDeps['fastify'] || allDeps['nestjs']) {
                        frameworks.add('express');
                        tags.add('backend');
                        tags.add('api');
                    }
                    if (allDeps['tailwindcss']) tags.add('tailwindcss');
                    if (allDeps['vscode'] || allDeps['@types/vscode']) {
                        frameworks.add('vscode-extension');
                        tags.add('vscode');
                    }
                    if (allDeps['@google-cloud/bigquery'] || allDeps['@google-cloud/storage']) {
                        tags.add('gcp');
                        tags.add('cloud');
                    }
                    if (allDeps['firebase'] || allDeps['firebase-admin']) {
                        tags.add('firebase');
                    }
                } catch {
                    // Ignorar error de parseo de package.json
                }
            }

            // 2. Detección en Flutter / Dart
            const pubspecPath = path.join(rootPath, 'pubspec.yaml');
            if (fs.existsSync(pubspecPath)) {
                languages.add('dart');
                frameworks.add('flutter');
                tags.add('mobile');
                tags.add('flutter');
                tags.add('dart');
                tags.add('cross-platform');
            }

            // 3. Detección en Python
            const pyFiles = ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py', 'environment.yml'];
            const hasPy = pyFiles.some(f => fs.existsSync(path.join(rootPath, f)));
            if (hasPy) {
                languages.add('python');
                tags.add('python');
                tags.add('backend');

                // Revisar frameworks Python
                for (const pyf of ['requirements.txt', 'pyproject.toml']) {
                    const p = path.join(rootPath, pyf);
                    if (fs.existsSync(p)) {
                        const content = await fs.promises.readFile(p, 'utf8');
                        if (content.includes('fastapi')) frameworks.add('fastapi');
                        if (content.includes('flask')) frameworks.add('flask');
                        if (content.includes('django')) frameworks.add('django');
                        if (content.includes('pandas') || content.includes('numpy') || content.includes('scipy')) tags.add('data-science');
                        if (content.includes('torch') || content.includes('tensorflow') || content.includes('scikit-learn')) tags.add('machine-learning');
                        if (content.includes('bigquery') || content.includes('google-cloud')) tags.add('gcp');
                    }
                }
            }

            // 4. Detección en Rust
            if (fs.existsSync(path.join(rootPath, 'Cargo.toml'))) {
                languages.add('rust');
                tags.add('rust');
                tags.add('systems');
            }

            // 5. Detección en Go
            if (fs.existsSync(path.join(rootPath, 'go.mod'))) {
                languages.add('go');
                tags.add('golang');
                tags.add('backend');
            }

            // 6. Detección en Docker / CI/CD
            if (fs.existsSync(path.join(rootPath, 'Dockerfile')) || fs.existsSync(path.join(rootPath, 'docker-compose.yml'))) {
                tags.add('docker');
                tags.add('devops');
            }
        } catch (err) {
            console.error('[ProjectProfiler] Error al perfilar proyecto:', err);
        }

        const langArr = Array.from(languages);
        const fwArr = Array.from(frameworks);
        const tagArr = Array.from(tags);

        const summary = `Proyecto: ${projectName} | Lenguajes: [${langArr.join(', ') || 'N/A'}] | Frameworks: [${fwArr.join(', ') || 'N/A'}] | Etiquetas: [${tagArr.join(', ')}]`;

        return {
            projectName,
            rootPath,
            languages: langArr,
            frameworks: fwArr,
            tags: tagArr,
            summary
        };
    }
}
