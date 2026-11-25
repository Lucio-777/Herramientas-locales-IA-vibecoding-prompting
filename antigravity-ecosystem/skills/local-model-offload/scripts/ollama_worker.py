#!/usr/bin/env python3
"""
ollama_worker.py
Herramienta de delegación local para Antigravity Agent.
Permite ejecutar tareas mecánicas (boilerplate, docstrings, commits, mocks, formateo)
en los modelos locales de Ollama (qwen2.5-coder:3b, qwen2.5-coder:7b) a coste cero de tokens.
"""

import sys
import os
import json
import argparse
import urllib.request
import urllib.error
import subprocess
import time

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")

SYSTEM_PROMPTS = {
    "raw": "Eres un asistente de programación técnico conciso. Responde directamente sin preámbulos ni explicaciones innecesarias.",
    "docstrings": "Eres un experto en documentación de código. Agrega comentarios JSDoc / Docstrings / tipos precisos al código proporcionado. Conserva la lógica intacta. Devuelve únicamente el código resultante sin bloques de markdown adicionales.",
    "boilerplate": "Eres un generador de código de alta velocidad. Genera las interfaces, DTOs, tipos TypeScript o mocks solicitados de forma concisa y rigurosa. Solo devuelve código limpio.",
    "commit": "Eres un experto en Git. Genera un mensaje de Conventional Commit profesional, en una sola línea principal (más cuerpo breve con bullets si es necesario), basado estrictamente en el git diff o descripción dada. No agregues saludos ni explicaciones.",
    "summarize": "Resume concisamente el texto o código en un párrafo estructurado o viñetas directas.",
    "test_mocks": "Genera datos de prueba simulados (mocks / fixtures) realistas y válidos basados en el esquema o función recibida."
}

def is_ollama_running():
    try:
        req = urllib.request.Request(f"{OLLAMA_HOST}/api/tags")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False

def ensure_ollama():
    if is_ollama_running():
        return True
    
    # Intentar arrancar Ollama si no está respondiendo
    try:
        subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=0x08000000 if os.name == 'nt' else 0)
        for _ in range(15):
            time.sleep(0.5)
            if is_ollama_running():
                return True
    except Exception:
        pass
    return False

def call_ollama(model: str, prompt: str, system_prompt: str = None, temperature: float = 0.2):
    if not ensure_ollama():
        return {
            "success": False,
            "error": f"No se pudo conectar con Ollama en {OLLAMA_HOST}. Verifica que el servicio esté ejecutándose."
        }

    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": temperature,
            "num_predict": 2048,
            "num_ctx": 4096,
            "num_thread": max(2, (os.cpu_count() or 4) - 2)
        }
    }
    if system_prompt:
        payload["system"] = system_prompt

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            return {
                "success": True,
                "model": model,
                "response": res_json.get("response", "").strip(),
                "total_duration_ms": res_json.get("total_duration", 0) // 1000000,
                "eval_count": res_json.get("eval_count", 0)
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

def main():
    parser = argparse.ArgumentParser(description="Delegación de tareas a modelos locales de Ollama")
    parser.add_argument("--model", "-m", default="qwen2.5-coder:3b", help="Modelo local a usar (ej: qwen2.5-coder:3b, qwen2.5-coder:7b, deepseek-r1:1.5b)")
    parser.add_argument("--task", "-t", choices=list(SYSTEM_PROMPTS.keys()), default="raw", help="Tipo de tarea especializada")
    parser.add_argument("--prompt", "-p", help="Texto del prompt")
    parser.add_argument("--file", "-f", help="Ruta de archivo para leer como entrada del prompt")
    parser.add_argument("--json", action="store_true", help="Devolver respuesta en formato JSON estructurado")
    parser.add_argument("--temp", type=float, default=0.2, help="Temperatura del modelo (0.0 a 1.0)")

    args = parser.parse_args()

    content = ""
    if args.file and os.path.exists(args.file):
        with open(args.file, "r", encoding="utf-8") as f:
            content = f.read()
    elif args.prompt:
        content = args.prompt
    elif not sys.stdin.isatty():
        content = sys.stdin.read()

    if not content.strip():
        print("Error: No se proporcionó contenido (usa --prompt, --file o pasa datos por stdin).", file=sys.stderr)
        sys.exit(1)

    system_prompt = SYSTEM_PROMPTS.get(args.task, SYSTEM_PROMPTS["raw"])
    result = call_ollama(args.model, content, system_prompt, args.temp)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if result["success"]:
            print(result["response"])
        else:
            print(f"[Error de delegación local]: {result['error']}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
