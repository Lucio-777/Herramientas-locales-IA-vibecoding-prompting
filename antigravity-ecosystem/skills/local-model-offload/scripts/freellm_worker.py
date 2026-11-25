#!/usr/bin/env python3
"""
freellm_worker.py
Cliente CLI para FreeLLMAPI (http://127.0.0.1:3001/v1).
Permite a Antigravity y a cualquier entorno de desarrollo invocar modelos gratuitos
de 70B/Flash con rotación automática y failover ante límites 429 a coste cero.
"""

import sys
import os
import json
import argparse
import urllib.request
import urllib.error

FREELLM_HOST = os.environ.get("FREELLM_HOST", "http://127.0.0.1:3001/v1")
FREELLM_API_KEY = os.environ.get("FREELLM_API_KEY", "freellmapi-86a31ceb7d1a23a23a9d761e0d2c92dfc9efb25675381691")

def is_freellm_running():
    try:
        req = urllib.request.Request("http://127.0.0.1:3001/api/ping")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False

def call_freellmapi(model: str, prompt: str, system_prompt: str = None, temperature: float = 0.2):
    if not is_freellm_running():
        return {
            "success": False,
            "error": "FreeLLMAPI no está respondiendo en http://127.0.0.1:3001. Ejecuta start-freellmapi.bat."
        }

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature
    }

    headers = {
        "Content-Type": "application/json"
    }
    if FREELLM_API_KEY:
        headers["Authorization"] = f"Bearer {FREELLM_API_KEY}"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{FREELLM_HOST}/chat/completions",
        data=data,
        headers=headers
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            res_json = json.loads(resp.read().decode("utf-8"))
            content = res_json.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            model_used = res_json.get("model", model)
            return {
                "success": True,
                "model": model_used,
                "response": content
            }
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        return {"success": False, "error": f"HTTP {e.code}: {err_msg}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def main():
    parser = argparse.ArgumentParser(description="Consulta a FreeLLMAPI (Proxy de rotación multi-nube)")
    parser.add_argument("--model", "-m", default="auto", help="Modelo o cadena en FreeLLMAPI (ej. auto, auto:coding, llama-3.3-70b-versatile, gemini-2.0-flash)")
    parser.add_argument("--prompt", "-p", help="Texto del prompt")
    parser.add_argument("--file", "-f", help="Ruta a archivo de entrada")
    parser.add_argument("--system", "-s", help="System prompt opcional")
    parser.add_argument("--json", action="store_true", help="Salida en formato JSON estructurado")
    parser.add_argument("--temp", type=float, default=0.2, help="Temperatura (0.0 a 1.0)")

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
        print("Error: Se requiere un prompt (usa --prompt, --file o stdin).", file=sys.stderr)
        sys.exit(1)

    result = call_freellmapi(args.model, content, args.system, args.temp)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        if result["success"]:
            print(result["response"])
        else:
            print(f"[FreeLLMAPI Error]: {result['error']}", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
