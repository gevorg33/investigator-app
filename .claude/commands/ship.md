---
description: Pre-merge gate — validate, review, and update task status
argument-hint: "[task ID]"
allowed-tools: Read, Grep, Glob, Edit, Bash
---

Pre-merge gate for task: $ARGUMENTS (if empty, the current IN_PROGRESS task).

Work through these in order and stop at the first failure.

**1. Scope** — `git status --short`. Every changed file should be in the task's
`Affected` paths. Flag anything that is not, and explain it.

**2. Validation** — run the task's validation commands. Report real output. A failure
stops the gate.

**3. Acceptance criteria** — walk each one. Tick only what you verified.

**4. Authorization** — if the change adds or modifies an endpoint, a tool, or a data
access path: confirm the authorization test exists and asserts on a different actor. No
test, no ship.

**5. Risk gate** — if the task is HIGH risk or touches auth, evidence access, payments,
retention, migrations or deployment: state plainly that human approval is required and
what exactly is being approved. Do not proceed past this on your own judgement.

**6. Audit** — confirm state mutations emit an audit event in the same transaction.

**7. Browser verification** — blocking. Run the app and look at it.
- User-facing surface: real flows plus the edge cases — empty, loading, error,
  permission-denied. Three viewports and a reduced-motion pass (`visual-qa`)
- No browser surface: **say so, and say how it was verified instead** — booting the service,
  probing endpoints, applying the migration to a clean database
- Anything found here is fixed and re-verified, never noted and shipped

**8. Documentation** — load `documentation-first`. This gate blocks the ship:
- Functionality documented, in this task
- FAQ / knowledge-base content updated where customer-visible behaviour changed
- Content is RAG-ingestible: frontmatter present, `visibility` correct, chunks self-contained
- Investigator / location / service / availability facts are **structured data**, not prose
- Outdated or conflicting entries superseded, not silently overwritten

**9. Update** — only if 1–8 pass: set `Status: DONE`, add the one-line note, tick the
verified criteria.

**10. Report** — files changed, validation status, how it was verified, documentation updated, what you did not do, out-of-scope
findings as proposed tasks, and any assumption a human should confirm.

Do not commit or push unless the user asks.
