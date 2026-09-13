#!/usr/bin/env bash
# PreToolUse guard. Fail-closed.
# Exit 0 = allow. Exit 2 = block, stderr is returned to Claude as the reason.
#
# Enforces plan.md: "Never share production secrets with local development or
# autonomous coding agents" and the destructive-operation approval gate (§4).
#
# All matching happens in Python with anchored regexes. Shell glob patterns were
# too loose for this job: `*.key*` matched `.keys()`, and `*production.yml*`
# matched a CI workflow. Word boundaries matter here.
#
# Heredoc bodies are stripped before scanning, because text written into a file
# is data, not a command. Redirect targets survive, so `cat > .env <<EOF` is
# still blocked, and a command appended after a heredoc is still seen.
set -uo pipefail

PAYLOAD="$(cat)"

if ! command -v python3 >/dev/null 2>&1; then
  # Fail closed on the coarse patterns rather than allowing everything through.
  case "$PAYLOAD" in
    *".env"*|*"id_rsa"*|*"/secrets/"*|*"rm -rf /"*|*"sk_live"*)
      echo "BLOCKED (python3 unavailable, coarse match): sensitive pattern in payload" >&2
      exit 2 ;;
  esac
  exit 0
fi

REASON=$(printf '%s' "$PAYLOAD" | python3 -c '
import json, re, sys

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)                      # unparseable payload: let the tool layer handle it

ti   = d.get("tool_input") or {}
tool = d.get("tool_name") or ""
cmd  = ti.get("command") or ""
path = ti.get("file_path") or ""

def strip_heredocs(s):
    # Collect every span first, then remove them in reverse. Mutating `s` while
    # iterating over finditer offsets leaves later matches pointing at stale
    # positions, so a command with two or more heredocs only got the first stripped.
    spans = []
    for m in re.finditer(r"<<-?\s*([\x27\x22]?)([A-Za-z_][A-Za-z0-9_]*)\1", s):
        marker = m.group(2)
        end = re.search(r"^\s*%s\s*$" % re.escape(marker), s[m.end():], re.M)
        if end:
            spans.append((m.end(), m.end() + end.end()))
    for start, stop in reversed(spans):
        s = s[:start] + s[stop:]
    return s

skeleton = strip_heredocs(cmd).replace("\n", " ")
target   = skeleton + " " + path

# --- Secrets, private material, production surfaces -------------------------
SECRETS = [
    # .env.example / .sample / .template are committed templates that hold variable
    # NAMES and no values — .gitignore excepts them deliberately. Everything else
    # matching .env is blocked.
    (r"(?<![\w.])\.env(?!\.(example|sample|template)\b)",
                                               "environment files may contain credentials"),
    (r"\.(pem|key|p12|pfx|keystore|jks)(?![\w])", "private key material"),
    (r"\bid_rsa\b|\bid_ed25519\b",             "private SSH key"),
    (r"/secrets/",                             "secrets directory"),
    (r"infrastructure/backups",                "database backups may contain evidence and PII"),
    (r"compose[/.]prod|compose/production|docker-compose\.prod",
                                               "production compose file — deployment requires human approval"),
    (r"\bsk_live\b|STRIPE_LIVE",               "live payment credentials"),
]
for pat, why in SECRETS:
    if re.search(pat, target):
        print(why); sys.exit(0)

# --- Destructive operations (Bash only) -------------------------------------
if tool == "Bash" or not tool:
    DESTRUCTIVE = [
        (r"rm\s+-[rf]{2}\s+(/|~)(\s|$)",       "recursive delete of a root or home path"),
        (r"rm\s+-rf\s+--no-preserve-root",     "recursive delete with root protection disabled"),
        (r"git\s+push\s+.*(--force\b|-f\b)",   "force push"),
        (r"git\s+reset\s+--hard",              "hard reset discards uncommitted work"),
        (r"chmod\s+777",                       "world-writable permissions"),
        (r"migration:revert",                  "migration revert — requires a verified backup and human approval"),
        (r"(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba)?sh",
                                               "piping a remote script into a shell"),
    ]
    for pat, why in DESTRUCTIVE:
        if re.search(pat, skeleton):
            print(why); sys.exit(0)

    # Destructive SQL counts only when a database client is actually invoked.
    # Otherwise docs, fixtures and test names mentioning these words trip the guard.
    CLIENT = r"\b(psql|pg_dump|pg_restore|mysql|prisma|typeorm|knex|sequelize)\b|migration:"
    DDL    = r"\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b"
    if re.search(CLIENT, skeleton) and re.search(DDL, skeleton, re.I):
        print("destructive SQL through a database client — requires human approval and a verified backup (plan.md §4)")
        sys.exit(0)
' 2>/dev/null)

if [ -n "$REASON" ]; then
  echo "BLOCKED by .claude/hooks/guard-secrets.sh: $REASON" >&2
  echo "If this is genuinely required, ask the user to run it themselves or to amend the hook." >&2
  exit 2
fi

exit 0
