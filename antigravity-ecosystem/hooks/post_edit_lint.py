#!/usr/bin/env python3
"""PostToolUse lightweight syntax check hook for edited files."""

import json
import os
import py_compile
import sys


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            return 0
        payload = json.loads(raw)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    file_path = (
        tool_input.get("Path")
        or tool_input.get("file_path")
        or tool_input.get("path")
        or ""
    )
    if not isinstance(file_path, str) or not file_path or not os.path.isfile(file_path):
        return 0

    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".py":
        try:
            py_compile.compile(file_path, doraise=True)
        except py_compile.PyCompileError as exc:
            sys.stderr.write(f"[post_edit_lint] Python syntax warning in {file_path}: {exc}\n")
    elif ext == ".json":
        try:
            with open(file_path, "r", encoding="utf-8") as fh:
                json.load(fh)
        except Exception as exc:
            sys.stderr.write(f"[post_edit_lint] JSON syntax warning in {file_path}: {exc}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())

