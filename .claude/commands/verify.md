---
description: Run the validation for the current task and report actual results
argument-hint: "[optional task ID]"
allowed-tools: Read, Grep, Glob, Bash
---

Validate task: $ARGUMENTS (if empty, the current IN_PROGRESS task).

1. Read the task's `Validation` commands from TODO.md. If it has none, run:
   `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
2. Run each one. Report the **actual output status** — not a summary of what you expect.
3. Walk each acceptance criterion and state whether it is genuinely met. A test whose
   name claims a behaviour but asserts something weaker does not meet it.
4. Confirm the authorization test exists and asserts on a *different* actor.
5. Confirm documentation was updated in this task (`documentation-first`), and that any
   customer-visible behaviour change is reflected in the knowledge base.

If anything fails:
- Fix it if your change caused it.
- If it was already failing, say so explicitly with evidence. Do not mark the task done.
- Never weaken a test, loosen a type, or add a skip to get green.

Report: commands run, real status of each, criteria met and unmet, and whether the task
is complete.
