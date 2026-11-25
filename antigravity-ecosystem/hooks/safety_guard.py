#!/usr/bin/env python3
"""PreToolUse safety guard hook for run_command."""

import json
import re
import sys

DANGEROUS_PATTERNS = [
    r"(?:^|\s)rm\s+-rf\s+/(?:\s|$)",
    r"(?:^|\s)rm\s+-rf\s+~(?:\s|$)",
    r"(?:^|\s)format\s+[a-zA-Z]:",
    r"(?:^|\s)mkfs\.",
    r":\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:",
    r"Remove-Item\s+.*-Recurse.*-Force\s+[a-zA-Z]:\\(?:\s|$|\"|')",
]


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        if not raw:
            return 0
        payload = json.loads(raw)
    except Exception:
        return 0

    tool_input = payload.get("tool_input") or {}
    cmd = (
        tool_input.get("CommandLine")
        or tool_input.get("command")
        or ""
    )
    if not isinstance(cmd, str):
        return 0

    for pattern in DANGEROUS_PATTERNS:
        if re.search(pattern, cmd, re.IGNORECASE):
            sys.stderr.write(
                f"[safety_guard] Blocked potentially catastrophic command matching '{pattern}'.\n"
            )
            return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())

