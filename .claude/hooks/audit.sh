#!/usr/bin/env bash
# PostToolUse audit trail -> .claude/logs/audit.jsonl
# The platform audits sensitive actions (plan.md §20); the harness audits itself too.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

LOG_DIR=".claude/logs"
mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

PAYLOAD="$(cat)"
command -v python3 >/dev/null 2>&1 || exit 0

printf '%s' "$PAYLOAD" | python3 -c '
import json, sys, datetime
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
ti = d.get("tool_input", {}) or {}
entry = {
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "session": d.get("session_id", ""),
    "tool": d.get("tool_name", ""),
    "file": ti.get("file_path", ""),
    "command": (ti.get("command", "") or "")[:400],
}
with open(".claude/logs/audit.jsonl", "a") as f:
    f.write(json.dumps(entry) + "\n")
' 2>/dev/null || true

exit 0
