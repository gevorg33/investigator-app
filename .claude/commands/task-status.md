---
description: Show the TODO.md queue — what is in progress, blocked, and next
allowed-tools: Read, Grep, Glob, Bash(git status:*), Bash(git log:*)
---

Summarize the work queue from TODO.md:

1. **In progress** — task ID, title, and what remains.
2. **Next eligible** — the first 3 tasks whose dependencies are all DONE.
3. **Blocked** — tasks waiting on an incomplete dependency; name the blocker.
4. **Awaiting approval** — tasks with `Human approval required: Yes` that have not been
   approved, and what specifically needs a decision.
5. **Recently done** — the last 5, with their one-line notes.

Then show uncommitted changes (`git status --short`) and flag any that do not belong to
the in-progress task's `Affected` paths — scope drift is worth catching early.

Keep it scannable. No prose paragraphs.
