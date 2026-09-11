import * as vscode from 'vscode';
import * as fs from 'fs';
import { SkillCatalogService, SkillItem } from './skillCatalogService';
import { ProjectProfile } from './projectProfiler';
import { OllamaService } from './ollamaService';

export interface SelectedSkill {
    id: string;
    name: string;
    relevanceScore: number;
    content: string;
    reason: string;
}

export class SkillMatcher {
    private static ollamaService = new OllamaService();

    /**
     * Determina si el usuario indicó explícitamente el uso o análisis de skills en su mensaje.
     */
    public static isSkillRequestedByUser(userPrompt: string): boolean {
        const lower = userPrompt.toLowerCase();

        // 1. Menciones directas con arroba, hashtag o comando
        if (/@skill\b|@skill:|#skill|\/skill\b|\[aplicar skill/i.test(lower)) {
            return true;
        }

        // 2. Frases y palabras clave explícitas donde el usuario indica el uso de skills
        const explicitPhrases = [
            'skill', 'skills', 'habilidad', 'habilidades',
            'usa la skill', 'usar la skill', 'usa las skills', 'usar las skills',
            'con la skill', 'con las skills', 'aplica la skill', 'aplica las skills',
            'analiza las skills', 'analiza tus skills', 'analiza todas las skills',
            'implementa las skills', 'implementa la skill', 'implementa solo las necesarias',
            'implementa sola las necesarias', 'solo las necesarias', 'sola las necesarias',
            'según la skill', 'guíate con la skill', 'utiliza la skill', 'utiliza las skills',
            'catálogo de skills', 'revisa tus skills', 'qué skills tienes',
            'use skill', 'use skills', 'apply skill', 'analyze skills'
        ];

        return explicitPhrases.some(phrase => lower.includes(phrase));
    }

    /**
     * Extrae un ID de skill explícito si el usuario utilizó la sintaxis @skill:<id> o similar.
     */
    private static extractExplicitSkillId(userPrompt: string): string | null {
        const match = userPrompt.match(/@skill:([a-zA-Z0-9_-]+)/i);
        if (match && match[1]) {
            return match[1].toLowerCase().trim();
        }
        return null;
    }

    /**
     * Calcula similitud de coseno entre dos vectores
     */
    private static cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Analiza el catálogo de skills y selecciona ÚNICAMENTE las estrictamente necesarias
     * cuando el usuario lo indique.
     */
    public static async matchSkills(
        userPrompt: string,
        profile: ProjectProfile,
        maxSkills: number = 2,
        forceRequested?: boolean
    ): Promise<SelectedSkill[]> {
        const config = vscode.workspace.getConfiguration('vibe-coding-local');
        const enableAutoSkills = config.get<boolean>('enableAutoSkills', true);
        const activationMode = config.get<string>('skillsActivationMode', 'on-demand');

        // Si las skills están desactivadas globalmente, retornar vacío
        if (!enableAutoSkills || activationMode === 'disabled') {
            return [];
        }

        // En modo 'on-demand' (por defecto), SOLO se analizan e implementan si el usuario lo indicó
        const isRequested = forceRequested ?? this.isSkillRequestedByUser(userPrompt);
        if (activationMode === 'on-demand' && !isRequested) {
            return [];
        }

        const catalog = await SkillCatalogService.getInstance().indexSkills();
        if (!catalog || catalog.length === 0) return [];

        const lowerPrompt = userPrompt.toLowerCase();
        const projectTags = new Set(profile.tags.map(t => t.toLowerCase()));
        const projectLangs = new Set(profile.languages.map(l => l.toLowerCase()));
        const projectFws = new Set(profile.frameworks.map(f => f.toLowerCase()));

        // CASO 1: El usuario indicó una skill explícita mediante @skill:<id>
        const explicitId = this.extractExplicitSkillId(userPrompt);
        if (explicitId) {
            const found = catalog.find(s => s.id.toLowerCase() === explicitId || s.name.toLowerCase() === explicitId);
            if (found) {
                try {
                    let content = await fs.promises.readFile(found.filePath, 'utf8');
                    content = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
                    return [{
                        id: found.id,
                        name: found.name,
                        relevanceScore: 1.0,
                        content,
                        reason: `Skill solicitada explícitamente por el usuario (@skill:${found.id})`
                    }];
                } catch (err) {
                    console.error(`[SkillMatcher] Error cargando skill explícita ${found.id}:`, err);
                }
            }
        }

        // CASO 2: Análisis completo del catálogo para encontrar SOLAMENTE las estrictamente necesarias
        // 1. Filtrado de congruencia tecnológica estricta
        const candidateSkills = catalog.filter(skill => {
            const skillTags = skill.tags.map(t => t.toLowerCase());

            // A. Si la petición del usuario menciona explícitamente el nombre o tecnología de la skill
            const isMentionedInPrompt = skillTags.some(t => t.length > 2 && lowerPrompt.includes(t)) ||
                lowerPrompt.includes(skill.id.toLowerCase());
            if (isMentionedInPrompt) return true;

            // B. Requisitos de framework específicos (flutter, react, vue, django, etc.)
            const frameworkTags = ['flutter', 'react', 'vue', 'angular', 'nextjs', 'fastapi', 'flask', 'django', 'dbt', 'dataform'];
            const hasSpecificFramework = skillTags.some(t => frameworkTags.includes(t));
            if (hasSpecificFramework) {
                const matchesFramework = skillTags.some(t => projectFws.has(t) || projectTags.has(t));
                if (!matchesFramework) return false;
            }

            // C. Requisitos de lenguaje específicos (dart, rust, golang, python)
            const strictLangs = ['dart', 'rust', 'golang', 'python'];
            const hasStrictLang = skillTags.some(t => strictLangs.includes(t));
            if (hasStrictLang) {
                const matchesLang = skillTags.some(t => projectLangs.has(t) || projectTags.has(t));
                if (!matchesLang) return false;
            }

            // D. Solo admitir skills generales si coinciden con palabras del prompt
            const words = skill.name.toLowerCase().split(/[\s\-_]+/);
            return words.some(w => w.length > 3 && lowerPrompt.includes(w));
        });

        if (candidateSkills.length === 0) return [];

        // 2. Ranking semántico y evaluación de necesidad real
        let userEmbedding: number[] = [];
        try {
            userEmbedding = await this.ollamaService.generateEmbedding(userPrompt);
        } catch {
            userEmbedding = [];
        }

        const scoredSkills: { skill: SkillItem; score: number; reason: string }[] = [];

        for (const skill of candidateSkills) {
            let score = 0;

            if (userEmbedding.length > 0 && skill.embedding && skill.embedding.length > 0) {
                score = this.cosineSimilarity(userEmbedding, skill.embedding);
            } else {
                const words = skill.name.toLowerCase().split(/[\s\-_]+/);
                const matchedWords = words.filter(w => w.length > 3 && lowerPrompt.includes(w));
                score = matchedWords.length / Math.max(words.length, 1);
            }

            // Bonificación por coincidencia directa con el stack
            const stackMatch = skill.tags.some(t => projectFws.has(t) || projectLangs.has(t));
            if (stackMatch) score += 0.05;

            // UMBRAL EXIGENTE: Solo considerar si hay necesidad real demostrable (> 0.65)
            // Esto evita que se inyecten skills irrelevantes o aleatorias
            if (score >= 0.65) {
                scoredSkills.push({
                    skill,
                    score,
                    reason: `Habilidad necesaria identificada con ${(score * 100).toFixed(0)}% de coincidencia técnica con tu solicitud`
                });
            }
        }

        // Ordenar por mayor pertinencia
        scoredSkills.sort((a, b) => b.score - a.score);

        // 3. Selección quirúrgica de únicamente las necesarias (máximo maxSkills)
        const topSelected = scoredSkills.slice(0, maxSkills);
        const results: SelectedSkill[] = [];

        for (const item of topSelected) {
            try {
                let fullContent = await fs.promises.readFile(item.skill.filePath, 'utf8');
                fullContent = fullContent.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();

                results.push({
                    id: item.skill.id,
                    name: item.skill.name,
                    relevanceScore: item.score,
                    content: fullContent,
                    reason: item.reason
                });
            } catch (err) {
                console.error(`[SkillMatcher] Error cargando contenido de skill ${item.skill.id}:`, err);
            }
        }

        return results;
    }
}
