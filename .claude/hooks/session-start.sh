#!/usr/bin/env bash
# SessionStart hook. stdout is injected into the session context.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

echo "=== Investigator harness ==="

# T-146: agent shells start on nvm's default Node, not the pinned one, and some specs need the
# pinned one (node:fs globSync is Node 22+). Put the .nvmrc version first on PATH for every
# later Bash call through CLAUDE_ENV_FILE, and say so loudly when that is not possible.
want="$(cat .nvmrc 2>/dev/null || true)"
have="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
if [ -n "$want" ] && [ "$have" != "$want" ]; then
  pinned="$(ls -d "${NVM_DIR:-$HOME/.nvm}"/versions/node/v"$want".*/bin 2>/dev/null | sort -V | tail -1)"
  if [ -n "$pinned" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export PATH=\"$pinned:\$PATH\"" >>"$CLAUDE_ENV_FILE"
    echo "node: v$have on PATH, switched to $("$pinned/node" --version) (.nvmrc) for this session"
  else
    echo "node: v${have:-none} on PATH but .nvmrc pins $want — WRONG NODE."
    echo "  >> Tests and builds may fail for reasons that are not the code's. Run: nvm use $want (nvm install $want if missing)"
  fi
fi

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "branch: $(git branch --show-current 2>/dev/null || echo detached)"
  changed=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  echo "uncommitted files: $changed"
else
  echo "branch: (not a git repository)"
fi

if [ ! -f TODO.md ]; then
  echo ""
  echo "TODO.md not found — run /next-task to bootstrap the queue."
  echo ""
  echo "Read CLAUDE.md and AGENTS.md before writing code. One task at a time."
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import re

text = open("TODO.md", encoding="utf-8").read()

# Split into task blocks: "### T-001 — Title" through the next heading.
blocks = re.split(r"^### ", text, flags=re.M)[1:]

def status_of(b):
    m = re.search(r"^- \*\*Status:\*\*\s*(\S+)", b, re.M)
    return m.group(1).strip("`") if m else ""

def field(b, name):
    m = re.search(r"^- \*\*%s:\*\*\s*(.+)$" % re.escape(name), b, re.M)
    return m.group(1).strip() if m else "?"

in_progress = [b for b in blocks if status_of(b) == "IN_PROGRESS"]
todo = [b for b in blocks if status_of(b) == "TODO"]

done = sum(1 for b in blocks if status_of(b) == "DONE")
print("")
print("tasks: %d total, %d done, %d in progress" % (len(blocks), done, len(in_progress)))

pick, label = (in_progress[0], "IN PROGRESS") if in_progress else \
              ((todo[0], "NEXT UP") if todo else (None, None))

if pick is None:
    print("no open tasks in TODO.md")
else:
    title = pick.splitlines()[0].strip()
    print("")
    print("--- %s: %s ---" % (label, title))
    for f in ("Priority", "Risk", "Human approval required", "Owner agent", "Depends on"):
        print("  %s: %s" % (f, field(pick, f)))
    if field(pick, "Human approval required").lower().startswith("yes"):
        print("  >> APPROVAL GATE: do not start without explicit human approval.")
PY
fi

echo ""
echo "Read CLAUDE.md and AGENTS.md before writing code. One task at a time."
exit 0
