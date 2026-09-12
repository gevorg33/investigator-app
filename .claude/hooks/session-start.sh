#!/usr/bin/env bash
# SessionStart hook. stdout is injected into the session context.
set -uo pipefail
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

echo "=== Investigator harness ==="

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
