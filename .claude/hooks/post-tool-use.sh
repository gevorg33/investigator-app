#!/usr/bin/env bash
# PostToolUse on Edit|Write. Formats the touched file if a formatter is configured.
# Silent no-op when tooling is not installed yet. Never blocks.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

PAYLOAD="$(cat)"
FILE=""
if command -v python3 >/dev/null 2>&1; then
  FILE=$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("tool_input",{}).get("file_path","") or "")
except Exception: pass' 2>/dev/null)
fi

[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.md)
    if [ -f node_modules/.bin/prettier ]; then
      node_modules/.bin/prettier --write "$FILE" >/dev/null 2>&1 || true
    fi
    ;;
esac

# Remind about translation parity when a catalog changes.
case "$FILE" in
  *packages/i18n/*|*locales/*)
    echo "i18n file changed — confirm en/ru/hy parity before marking the task done." >&2
    ;;
esac

exit 0
