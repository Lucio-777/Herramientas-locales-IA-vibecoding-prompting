import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RAGChunk, RAGSearchResult, ToolExecutionResult } from '../types';
import { OllamaService } from '../services/ollamaService';

export class RAGTools {
    private static indexedChunks: RAGChunk[] = [];
    private static isIndexing: boolean = false;
    private static lastIndexTime: number = 0;

    /**
     * Calcula la similitud de coseno entre dos vectores densos
     */
    public static cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
            return 0;
        }
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
     * Indexa los archivos del workspace generando chunks y embeddings con nomic-embed-text
     */
    public static async indexWorkspace(ollamaService: OllamaService, onProgress?: (msg: string) => void): Promise<{ success: boolean; chunkCount: number; message: string }> {
        if (this.isIndexing) {
            return { success: false, chunkCount: this.indexedChunks.length, message: 'Ya hay una indexación en progreso.' };
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return { success: false, chunkCount: 0, message: 'No hay workspace abierto para indexar.' };
        }

        this.isIndexing = true;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const supportedExtensions = new Set([
            '.ts', '.js', '.tsx', '.jsx', '.py', '.json', '.md', '.html', '.css', '.rs', '.go', '.cpp', '.c', '.h', '.java', '.sql', '.yaml', '.yml'
        ]);
        const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'out', '.vscode', 'coverage', '.cache']);

        try {
            const filesToIndex: string[] = [];

            const scanDir = async (dir: string) => {
                const entries = await fs.promises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (ignoredDirs.has(entry.name)) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await scanDir(fullPath);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (supportedExtensions.has(ext)) {
                            // Omitir archivos excesivamente grandes (> 100KB)
                            const stats = await fs.promises.stat(fullPath);
                            if (stats.size <= 100 * 1024) {
                                filesToIndex.push(fullPath);
                            }
                        }
                    }
                }
            };

            await scanDir(rootPath);

            const newChunks: RAGChunk[] = [];
            const chunkSize = 35; // 35 líneas por chunk
            const overlap = 8; // 8 líneas de solapamiento

            if (onProgress) onProgress(`Indexando ${filesToIndex.length} archivos con nomic-embed-text...`);

            for (let fIdx = 0; fIdx < filesToIndex.length; fIdx++) {
                const file = filesToIndex[fIdx];
                const relPath = path.relative(rootPath, file);
                const content = await fs.promises.readFile(file, 'utf8');
                const lines = content.split(/\r?\n/);

                for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
                    const chunkLines = lines.slice(i, i + chunkSize);
                    if (chunkLines.length === 0) break;

                    const chunkText = chunkLines.join('\n').trim();
                    if (chunkText.length < 20) continue; // Descartar fragmentos insignificantes

                    const chunkHeader = `Archivo: ${relPath} (Líneas ${i + 1}-${i + chunkLines.length})\n${chunkText}`;
                    
                    try {
                        const embedding = await ollamaService.generateEmbedding(chunkHeader);
                        newChunks.push({
                            id: `${relPath}#L${i + 1}`,
                            filePath: file,
                            relativePath: relPath,
                            startLine: i + 1,
                            endLine: i + chunkLines.length,
                            content: chunkHeader,
                            embedding: embedding
                        });
                    } catch (e: any) {
                        console.warn(`Error al calcular embedding para ${relPath}: ${e.message}`);
                    }
                }

                if (onProgress && fIdx % 5 === 0) {
                    onProgress(`Procesando archivos (${fIdx + 1}/${filesToIndex.length})...`);
                }
            }

            this.indexedChunks = newChunks;
            this.lastIndexTime = Date.now();
            this.isIndexing = false;

            return {
                success: true,
                chunkCount: newChunks.length,
                message: `Indexación completada: ${newChunks.length} fragmentos de código indexados en ${filesToIndex.length} archivos.`
            };
        } catch (error: any) {
            this.isIndexing = false;
            return {
                success: false,
                chunkCount: this.indexedChunks.length,
                message: `Error durante la indexación RAG: ${error.message}`
            };
        }
    }

    /**
     * Búsqueda semántica sobre los fragmentos indexados
     */
    public static async semanticSearch(
        query: string,
        ollamaService: OllamaService,
        topK: number = 4
    ): Promise<ToolExecutionResult> {
        try {
            if (this.indexedChunks.length === 0) {
                // Auto-indexar si aún no hay fragmentos
                const autoIndex = await this.indexWorkspace(ollamaService);
                if (!autoIndex.success || this.indexedChunks.length === 0) {
                    return {
                        toolName: 'semanticSearch',
                        success: false,
                        output: 'No hay índice semántico disponible y no se pudo indexar el workspace. Usa readFile o listDirectory en su lugar.'
                    };
                }
            }

            const queryEmbedding = await ollamaService.generateEmbedding(query);
            if (!queryEmbedding || queryEmbedding.length === 0) {
                return {
                    toolName: 'semanticSearch',
                    success: false,
                    output: 'No se pudo generar el vector de búsqueda para la consulta dada.'
                };
            }

            const scoredChunks: RAGSearchResult[] = this.indexedChunks
                .map(chunk => ({
                    chunk,
                    similarity: this.cosineSimilarity(queryEmbedding, chunk.embedding || [])
                }))
                .filter(res => res.similarity > 0.3) // Umbral mínimo de relevancia
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);

            if (scoredChunks.length === 0) {
                return {
                    toolName: 'semanticSearch',
                    success: true,
                    output: `No se encontraron fragmentos con suficiente similitud semántica para '${query}'.`
                };
            }

            let resultOutput = `Resultados de Búsqueda Semántica RAG para "${query}" (${scoredChunks.length} coincidencias):\n\n`;
            scoredChunks.forEach((item, idx) => {
                const simPercentage = (item.similarity * 100).toFixed(1);
                resultOutput += `--- [${idx + 1}] ${item.chunk.relativePath} (Líneas ${item.chunk.startLine}-${item.chunk.endLine} | Relevancia: ${simPercentage}%) ---\n`;
                resultOutput += `${item.chunk.content}\n\n`;
            });

            return {
                toolName: 'semanticSearch',
                success: true,
                output: resultOutput.trim()
            };
        } catch (error: any) {
            return {
                toolName: 'semanticSearch',
                success: false,
                output: `Error en búsqueda semántica: ${error.message}`
            };
        }
    }

    public static getChunkCount(): number {
        return this.indexedChunks.length;
    }
}
