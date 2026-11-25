#!/usr/bin/env python3
"""
rag_query.py
Consulta el índice vectorial local (.vibecoding/cache/vector_index.json)
usando nomic-embed-text en Ollama sin gastar tokens de nube.
"""

import sys
import os
import json
import argparse
import urllib.request
import math

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

def cosine_similarity(vec_a, vec_b):
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

def get_query_embedding(query: str, model: str = "nomic-embed-text"):
    payload = json.dumps({"model": model, "prompt": query}).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/embeddings",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        return res.get("embedding", [])

def find_vector_cache(start_path: str):
    curr = os.path.abspath(start_path)
    while True:
        cache_path = os.path.join(curr, ".vibecoding", "cache", "vector_index.json")
        if os.path.exists(cache_path):
            return cache_path, curr
        parent = os.path.dirname(curr)
        if parent == curr:
            break
        curr = parent
    return None, None

def search_index(query: str, workspace_path: str = ".", top_k: int = 4):
    cache_path, root_dir = find_vector_cache(workspace_path)
    if not cache_path:
        return {
            "success": False,
            "error": f"No se encontró caché vectorial (.vibecoding/cache/vector_index.json) en o sobre '{workspace_path}'. Ejecuta primero 'Indexar Workspace' en VibeCoding."
        }

    try:
        with open(cache_path, "r", encoding="utf-8") as f:
            cache_data = json.load(f)
    except Exception as e:
        return {"success": False, "error": f"Error leyendo caché vectorial: {e}"}

    query_vec = get_query_embedding(query, cache_data.get("model", "nomic-embed-text"))
    if not query_vec:
        return {"success": False, "error": "No se pudo obtener embedding para la consulta."}

    scored_chunks = []
    files_map = cache_data.get("files", {})
    for rel_path, file_entry in files_map.items():
        for chunk in file_entry.get("chunks", []):
            chunk_vec = chunk.get("embedding")
            if chunk_vec:
                score = cosine_similarity(query_vec, chunk_vec)
                scored_chunks.append({
                    "score": score,
                    "relativePath": rel_path,
                    "startLine": chunk.get("startLine"),
                    "endLine": chunk.get("endLine"),
                    "content": chunk.get("content", "")
                })

    scored_chunks.sort(key=lambda x: x["score"], reverse=True)
    results = scored_chunks[:top_k]

    return {
        "success": True,
        "query": query,
        "cacheFile": cache_path,
        "totalIndexedFiles": len(files_map),
        "results": results
    }

def main():
    parser = argparse.ArgumentParser(description="Búsqueda semántica RAG local con nomic-embed-text")
    parser.add_argument("query", help="Texto de la consulta semántica")
    parser.add_argument("--dir", "-d", default=".", help="Directorio raíz del proyecto o subdirectorio")
    parser.add_argument("--top-k", "-k", type=int, default=4, help="Número de fragmentos a recuperar")
    parser.add_argument("--json", action="store_true", help="Salida en formato JSON estructurado")

    args = parser.parse_args()
    res = search_index(args.query, args.dir, args.top_k)

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        if not res["success"]:
            print(f"[Error RAG Local]: {res['error']}", file=sys.stderr)
            sys.exit(1)
        
        print(f"=== Búsqueda Semántica Local ({len(res['results'])} resultados) ===")
        for i, item in enumerate(res["results"], 1):
            print(f"\n[{i}] {item['relativePath']} (Líneas {item['startLine']}-{item['endLine']}) - Similitud: {item['score']:.4f}")
            print("-" * 60)
            print(item['content'].strip())

if __name__ == "__main__":
    main()
