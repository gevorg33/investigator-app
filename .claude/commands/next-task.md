---
description: Select and start the next eligible task from TODO.md
argument-hint: "[optional task ID to force]"
allowed-tools: Read, Grep, Glob, Edit, Bash(git status:*), Bash(git branch:*)
---

Load the `task-workflow` skill and follow it.

Target task: $ARGUMENTS (if empty, select the first eligible task).

Eligibility: `Status: TODO`, all dependencies `DONE`, and either no human approval
required or approval already given in this conversation.

Before writing any code:

1. State the task ID, title, risk level and owner agent.
2. If it is approval-gated and unapproved, stop and ask. Do not silently skip to an
   easier task.
3. Read the `plan.md` section it cites and the files in `Affected`. Read them — do not
   assume their contents.
4. Name the existing pattern you will follow, or state that you are setting a new one.
5. Set `Status: IN_PROGRESS` in TODO.md.

Then implement, staying strictly inside the task's scope.
