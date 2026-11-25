import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RAGChunk, RAGSearchResult, ToolExecutionResult } from '../types';
import { OllamaService } from '../services/ollamaService';

interface FileCacheEntry {
    sha256: string;
    mtime: number;
    chunks: RAGChunk[];
}

interface PersistentVectorCache {
    version: number;
    model: string;
    updatedAt: number;
    files: { [relativePath: string]: FileCacheEntry };
}

export class RAGTools {
    private static indexedChunks: RAGChunk[] = [];
    private static isIndexing: boolean = false;
    private static lastIndexTime: number = 0;
    private static readonly CACHE_VERSION = 1;

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

    private static getCacheFilePath(rootPath: string): string {
        return path.join(rootPath, '.vibecoding', 'cache', 'vector_index.json');
    }

    private static async loadCacheFromDisk(rootPath: string): Promise<PersistentVectorCache | null> {
        try {
            const cachePath = this.getCacheFilePath(rootPath);
            if (!fs.existsSync(cachePath)) return null;
            const raw = await fs.promises.readFile(cachePath, 'utf8');
            const data: PersistentVectorCache = JSON.parse(raw);
            if (data && data.version === this.CACHE_VERSION && data.files) {
                return data;
            }
            return null;
        } catch (e: any) {
            console.warn(`[RAGTools] No se pudo leer caché vectorial: ${e.message}`);
            return null;
        }
    }

    private static async saveCacheToDisk(rootPath: string, cache: PersistentVectorCache): Promise<void> {
        try {
            const cachePath = this.getCacheFilePath(rootPath);
            const cacheDir = path.dirname(cachePath);
            await fs.promises.mkdir(cacheDir, { recursive: true });
            await fs.promises.writeFile(cachePath, JSON.stringify(cache), 'utf8');
        } catch (e: any) {
            console.warn(`[RAGTools] Error guardando caché vectorial: ${e.message}`);
        }
    }

    /**
     * Carga rápida de vectores desde caché persistente si la memoria está vacía
     */
    public static async loadFromDiskIfAvailable(): Promise<boolean> {
        if (this.indexedChunks.length > 0) return true;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return false;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const cache = await this.loadCacheFromDisk(rootPath);
        if (cache && Object.keys(cache.files).length > 0) {
            const chunks: RAGChunk[] = [];
            for (const relPath in cache.files) {
                chunks.push(...cache.files[relPath].chunks);
            }
            this.indexedChunks = chunks;
            this.lastIndexTime = cache.updatedAt;
            console.warn(`[RAGTools] Cargados ${chunks.length} chunks instantáneamente desde caché persistente en disco.`);
            return true;
        }
        return false;
    }

    /**
     * Indexa los archivos del workspace con hash incremental SHA-256 y persistencia en disco
     */
    public static async indexWorkspace(
        ollamaService: OllamaService,
        onProgress?: (msg: string) => void
    ): Promise<{ success: boolean; chunkCount: number; message: string }> {
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
        const ignoredDirs = new Set(['node_modules', '.git', 'dist', 'out', '.vscode', 'coverage', '.cache', '.vibecoding']);

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
                            const stats = await fs.promises.stat(fullPath);
                            if (stats.size <= 100 * 1024) {
                                filesToIndex.push(fullPath);
                            }
                        }
                    }
                }
            };

            await scanDir(rootPath);

            // Cargar caché previo en disco
            const existingCache = (await this.loadCacheFromDisk(rootPath)) || {
                version: this.CACHE_VERSION,
                model: 'nomic-embed-text',
                updatedAt: Date.now(),
                files: {}
            };

            const updatedFilesCache: { [relativePath: string]: FileCacheEntry } = {};
            const chunkSize = 35; // 35 líneas por chunk
            const overlap = 8;    // 8 líneas de solapamiento
            let reusedFiles = 0;
            let newlyEmbeddedFiles = 0;

            if (onProgress) onProgress(`Analizando ${filesToIndex.length} archivos para indexación incremental...`);

            for (let fIdx = 0; fIdx < filesToIndex.length; fIdx++) {
                const file = filesToIndex[fIdx];
                const relPath = path.relative(rootPath, file);
                const stats = await fs.promises.stat(file);
                const content = await fs.promises.readFile(file, 'utf8');
                const fileHash = crypto.createHash('sha256').update(content).digest('hex');

                // Si el archivo no ha cambiado y ya está en caché, reutilizar chunks
                const cachedEntry = existingCache.files[relPath];
                if (cachedEntry && cachedEntry.sha256 === fileHash && cachedEntry.chunks.length > 0) {
                    updatedFilesCache[relPath] = cachedEntry;
                    reusedFiles++;
                    continue;
                }

                // Si es nuevo o modificado, generar chunks y embeddings
                newlyEmbeddedFiles++;
                const lines = content.split(/\r?\n/);
                const fileChunks: RAGChunk[] = [];

                for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
                    const chunkLines = lines.slice(i, i + chunkSize);
                    if (chunkLines.length === 0) break;

                    const chunkText = chunkLines.join('\n').trim();
                    if (chunkText.length < 20) continue;

                    const chunkHeader = `Archivo: ${relPath} (Líneas ${i + 1}-${i + chunkLines.length})\n${chunkText}`;
                    try {
                        const embedding = await ollamaService.generateEmbedding(chunkHeader);
                        fileChunks.push({
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

                updatedFilesCache[relPath] = {
                    sha256: fileHash,
                    mtime: stats.mtimeMs,
                    chunks: fileChunks
                };

                if (onProgress && fIdx % 4 === 0) {
                    onProgress(`Indexando nuevos cambios (${newlyEmbeddedFiles} nuevos/editados, ${reusedFiles} en caché)...`);
                }
            }

            // Consolidar todos los chunks de archivos vigentes
            const allChunks: RAGChunk[] = [];
            for (const rPath in updatedFilesCache) {
                allChunks.push(...updatedFilesCache[rPath].chunks);
            }

            this.indexedChunks = allChunks;
            this.lastIndexTime = Date.now();

            // Guardar caché persistente a disco
            await this.saveCacheToDisk(rootPath, {
                version: this.CACHE_VERSION,
                model: 'nomic-embed-text',
                updatedAt: this.lastIndexTime,
                files: updatedFilesCache
            });

            this.isIndexing = false;

            return {
                success: true,
                chunkCount: allChunks.length,
                message: `Indexación incremental completada: ${allChunks.length} fragmentos (${reusedFiles} archivos desde caché, ${newlyEmbeddedFiles} procesados). Guardado en .vibecoding/cache/vector_index.json.`
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
     * Búsqueda semántica sobre los fragmentos indexados (con carga instantánea de caché si existe)
     */
    public static async semanticSearch(
        query: string,
        ollamaService: OllamaService,
        topK: number = 4
    ): Promise<ToolExecutionResult> {
        try {
            if (this.indexedChunks.length === 0) {
                const loadedFromDisk = await this.loadFromDiskIfAvailable();
                if (!loadedFromDisk) {
                    const autoIndex = await this.indexWorkspace(ollamaService);
                    if (!autoIndex.success || this.indexedChunks.length === 0) {
                        return {
                            toolName: 'semanticSearch',
                            success: false,
                            output: 'No hay índice semántico disponible y no se pudo indexar el workspace. Usa readFile o listDirectory en su lugar.'
                        };
                    }
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
                .filter(res => res.similarity > 0.25)
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
