---
id: kb-investigator-notes-and-tasks
title: Working notes and your task list
audience: investigator
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-26
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/investigation-workspace
tags: [notes, tasks, work plan, privacy, sharing, assignments]
---

# Working notes and your task list

## What are notes and tasks in an assignment?

Notes are your working material inside an assignment: what you checked, what you suspect, lines
of inquiry you are following or have dropped. Tasks are your work plan for the assignment: what
you still have to do, what is under way, and what is finished. Both belong to the assignment they
were written in, and to nothing else.

## Who can see my notes and tasks?

Only you. Every note and every task is **private** when you create it: the customer cannot see it,
and nobody else on the platform can either. If you work in an agency, that includes your
colleagues and the agency's owner. The privacy is enforced by the database itself, not only by
the screens.

## Can I share a note or a task with the customer?

Yes, one at a time. Mark a note or a task as **shared** and the customer of that assignment can
read it; mark it private again and it disappears from their view. Every change of sharing is
recorded, with who made it and when.

Sharing is deliberate for a reason. Notes hold thinking in progress — a hypothesis you later
ruled out, a suspicion you could not confirm. A customer who reads "the subject may be involved in
X" may treat it as a finding even after you dismissed it. Share what you would stand behind.
Taking a note back to private hides it from then on, but it cannot undo what the customer has
already read.

## Are notes the same as evidence?

No. Evidence is fixed once it is stored: it is checksummed, its handling is recorded, and it
cannot be edited. A note is yours to rewrite as often as your thinking moves. Nothing in a note
becomes evidence, and a note is not a finding in your report. If something in a note matters,
put it in the report, with what it rests on.

## How do I move a task along?

A task starts as **to do**. You can start it (**in progress**), finish it (**done**) or drop it
(**cancelled**) from to do or from in progress, and put work in progress back to to do. A task
you finished or cancelled by mistake can be **reopened**, which returns it to to do. A cancelled
task cannot jump straight to done; reopen it first.

Each task can also have a description, a due date (a day, not a time) and a place in your list,
which you can change.

## Can I delete a note or a task?

Yes. A deleted note or task disappears from your view and, if it was shared, from the customer's.
Deleting is final — it cannot be restored — and it is recorded. The platform keeps the record for
as long as the assignment's records are kept, so the history of the work stays complete.

## Why can I not add notes or tasks to this assignment?

Notes and tasks can be written, edited, shared, moved and deleted only while the work is live —
after you have accepted the assignment, and until it is completed, including while you revise a
submitted report. Before you accept, the work is not yet yours. Once the assignment is completed,
cancelled or suspended, your notes and tasks become read-only, and you and the customer can still
read what each of you could read before.

## Can I use notes from another assignment?

No. Each assignment's notes and tasks belong to that assignment alone and cannot be seen from any
other, even by you. Carrying them across would let one customer's case leak into another's.

## Is there a screen for notes and tasks yet?

Not yet. The records and the rules above exist, and the investigation workspace screens that show
them come next.
