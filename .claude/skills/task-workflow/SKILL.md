---
name: task-workflow
description: The TODO.md work loop for this repo — how to select the next eligible task, implement it, validate it, and update its status. Use at the start of any work session, when asked "what's next", when picking up a task, or before marking anything done.
---

# Task workflow

One task at a time. A task is done when its validation passes — not when the code looks
right.

## 1. Select

Read `TODO.md`. Pick the first task where:

- `Status: TODO`
- every task in `Depends on` has `Status: DONE`
- `Human approval required: No`, **or** the user has approved it in this conversation

If the top eligible task is approval-gated and unapproved, stop and ask. Do not skip past
it to an easier task without saying so.

Set `Status: IN_PROGRESS` before you start. This is what the SessionStart hook surfaces.

## 2. Understand before editing

- Read the task's `Affected` paths. Read them, do not assume them.
- Read the `plan.md` section the task cites.
- Find the existing pattern. This repo has conventions; match them rather than inventing
  a parallel one. If no pattern exists yet, you are setting it — say so in the handoff.

## 3. Implement

Stay inside the task. If you find something else wrong:

- Security or data-loss severity: stop, report it, ask.
- Anything else: write it as a new `TODO.md` task and keep going.

Never expand scope silently. A task that touched twice the files it named is a review
problem even when the code is good.

## 4. Validate

Run the task's `Validation` commands. If the task has none, run:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Report **actual output**. If something fails:

- Fix it if it is your change.
- If it was already failing, say so explicitly with evidence, and do not mark the task
  done on the grounds that "it was broken before".

Never weaken a test, loosen a type, or add a skip to make validation pass. That converts
a visible failure into an invisible one.

## 5. Document

Before the task can be marked done, load `documentation-first` and answer its checklist:

- Is the functionality documented?
- Is the relevant FAQ / knowledge-base content updated?
- Can the Assistant retrieve it — ingested, correct `visibility`, sensible chunks?
- If it involves investigators, locations, services or availability: is that **structured
  data in PostgreSQL**, not prose?
- Are outdated or conflicting entries superseded?

Documentation lands in **this** task, not a follow-up. "Docs to come" means the task is
not finished.

## 6. Update

Only after validation and documentation pass:

- `Status: DONE`
- Add a one-line note: what changed and where.
- Tick the acceptance criteria you actually verified. Leave unticked anything you did not.

## 7. Hand off

Report, in this order:

1. Task ID and files changed
2. Validation commands run and their real status
3. Documentation updated, and whether it is RAG-ingestible
4. What you did not do, and why
5. Out-of-scope findings, as proposed tasks
6. Assumptions a human should confirm

## Anti-patterns

| Don't | Do |
|---|---|
| Mark done because the code compiles | Run the validation commands |
| Silently fix an unrelated bug | File it as a task |
| Start a second task "while I'm here" | Finish, hand off, then select again |
| Report success with a failing test | Report the failure with its output |
| Leave docs for a follow-up task | Update them in this task |
| Write investigator data into a markdown file | Put it in PostgreSQL |
| Delete a failing test | Fix the code, or escalate |
