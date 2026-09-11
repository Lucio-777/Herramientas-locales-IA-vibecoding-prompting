import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OllamaService } from './ollamaService';

export interface SkillItem {
    id: string;
    name: string;
    description: string;
    tags: string[];
    filePath: string;
    embedding?: number[];
}

export class SkillCatalogService {
    private static instance: SkillCatalogService;
    private skills: Map<string, SkillItem> = new Map();
    private isIndexing = false;
    private lastIndexTime = 0;
    private ollamaService: OllamaService;

    private constructor() {
        this.ollamaService = new OllamaService();
    }

    public static getInstance(): SkillCatalogService {
        if (!SkillCatalogService.instance) {
            SkillCatalogService.instance = new SkillCatalogService();
        }
        return SkillCatalogService.instance;
    }

    /**
     * Retorna todas las skills indexadas en memoria
     */
    public getAllSkills(): SkillItem[] {
        return Array.from(this.skills.values());
    }

    /**
     * Obtiene una skill por su ID
     */
    public getSkill(id: string): SkillItem | undefined {
        return this.skills.get(id);
    }

    /**
     * Carga o actualiza el catálogo de skills desde la ruta configurada.
     * BUG FIX: La ruta por defecto ahora usa os.homedir() en lugar de una ruta hardcodeada,
     * haciendo la extensión portable para cualquier usuario.
     */
    public async indexSkills(force: boolean = false): Promise<SkillItem[]> {
        if (this.isIndexing) return this.getAllSkills();

        const now = Date.now();
        // Si se indexó hace menos de 10 minutos y no se fuerza, retornar caché
        if (!force && this.skills.size > 0 && (now - this.lastIndexTime) < 10 * 60 * 1000) {
            return this.getAllSkills();
        }

        const config = vscode.workspace.getConfiguration('vibe-coding-local');
        // BUG FIX: Usar os.homedir() para el default en lugar de la ruta del usuario específico
        const defaultSkillsPath = path.join(os.homedir(), 'Escritorio', 'skills');
        let skillsPath = config.get<string>('skillsPath', defaultSkillsPath);

        // Expandir ~ si se utiliza
        if (skillsPath.startsWith('~')) {
            skillsPath = path.join(os.homedir(), skillsPath.slice(1));
        }

        if (!fs.existsSync(skillsPath)) {
            console.warn(`[SkillCatalog] Directorio de skills no encontrado en: ${skillsPath}. Configura 'vibe-coding-local.skillsPath' para habilitar skills.`);
            return [];
        }

        this.isIndexing = true;
        console.log(`[SkillCatalog] Escaneando catálogo de skills en '${skillsPath}'...`);

        try {
            const discoveredFiles: string[] = [];
            await this.findSkillFiles(skillsPath, discoveredFiles, 0, 4);

            const newSkillsMap = new Map<string, SkillItem>();

            for (const filePath of discoveredFiles) {
                try {
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const parsed = this.parseSkillContent(filePath, content);
                    if (parsed) {
                        newSkillsMap.set(parsed.id, parsed);
                    }
                } catch (err) {
                    console.error(`[SkillCatalog] Error leyendo skill '${filePath}':`, err);
                }
            }

            this.skills = newSkillsMap;
            this.lastIndexTime = Date.now();
            console.log(`[SkillCatalog] ${this.skills.size} skills descubiertas.`);

            // Generar embeddings en segundo plano (sin bloquear UI)
            this.generateEmbeddingsInBackground(config.get<string>('embeddingModel', 'nomic-embed-text:latest'));

            return this.getAllSkills();
        } catch (error) {
            console.error('[SkillCatalog] Error escaneando skills:', error);
            return this.getAllSkills();
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Escaneo recursivo buscando SKILL.md o archivos .md
     */
    private async findSkillFiles(dir: string, result: string[], depth: number, maxDepth: number) {
        if (depth > maxDepth) return;

        try {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true });

            // Si este directorio contiene un SKILL.md, registrarlo directamente y no profundizar
            const skillMd = entries.find(e => e.isFile() && e.name.toLowerCase() === 'skill.md');
            if (skillMd) {
                result.push(path.join(dir, skillMd.name));
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    await this.findSkillFiles(fullPath, result, depth + 1, maxDepth);
                } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.toLowerCase().includes('readme')) {
                    result.push(fullPath);
                }
            }
        } catch {
            // Ignorar permisos denegados o subcarpetas inaccesibles
        }
    }

    /**
     * Parsea frontmatter YAML o encabezados del archivo de skill
     */
    private parseSkillContent(filePath: string, content: string): SkillItem | null {
        const parentDirName = path.basename(path.dirname(filePath));
        const fileBaseName = path.basename(filePath, path.extname(filePath));
        const skillId = fileBaseName.toLowerCase() === 'skill' ? parentDirName : fileBaseName;

        let name = skillId;
        let description = '';
        const tags = new Set<string>();

        // 1. Extraer Frontmatter YAML si existe
        const yamlMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (yamlMatch) {
            const yamlText = yamlMatch[1];
            const nameMatch = yamlText.match(/name:\s*(.+)/);
            if (nameMatch) name = nameMatch[1].replace(/['"]/g, '').trim();

            const descMatch = yamlText.match(/description:\s*(.+)/);
            if (descMatch) description = descMatch[1].replace(/['"]/g, '').trim();
        }

        // 2. Si no hay frontmatter, buscar primer encabezado H1 y primer párrafo
        if (!description) {
            const h1Match = content.match(/^#\s+(.+)/m);
            if (h1Match) name = h1Match[1].trim();

            const paragraphs = content.replace(/^#+.*$/gm, '').replace(/```[\s\S]*?```/g, '').trim().split('\n\n');
            if (paragraphs.length > 0) {
                description = paragraphs[0].replace(/\n/g, ' ').substring(0, 300).trim();
            }
        }

        if (!description) {
            description = `Habilidad especializada para ${name}`;
        }

        // 3. Extracción automática de tags / palabras clave
        const fullTextForTags = `${skillId} ${name} ${description}`.toLowerCase();
        const knownTags = [
            'flutter', 'dart', 'react', 'vue', 'angular', 'nextjs', 'typescript', 'javascript',
            'python', 'fastapi', 'flask', 'django', 'rust', 'golang', 'bigquery', 'dbt', 'dataform',
            'docker', 'firebase', 'a11y', 'git', 'testing', 'unit-test', 'security', 'database',
            'sql', 'cloud', 'gcp', 'aws', 'mobile', 'frontend', 'backend', 'api'
        ];

        for (const t of knownTags) {
            if (fullTextForTags.includes(t)) {
                tags.add(t);
            }
        }

        if (tags.size === 0) {
            tags.add('general');
        }

        return {
            id: skillId,
            name: name,
            description: description,
            tags: Array.from(tags),
            filePath: filePath
        };
    }

    /**
     * Genera embeddings en segundo plano usando Ollama
     */
    private async generateEmbeddingsInBackground(_embeddingModel: string) {
        for (const skill of this.skills.values()) {
            if (skill.embedding && skill.embedding.length > 0) continue;

            try {
                const textToEmbed = `Skill: ${skill.name}. Tags: ${skill.tags.join(', ')}. Descripción: ${skill.description}`;
                skill.embedding = await this.ollamaService.generateEmbedding(textToEmbed);
            } catch {
                // Silencioso si Ollama está ocupado
            }
        }
    }
}
