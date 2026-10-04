---
id: kb-staff-legal-holds
title: Placing and releasing legal holds
audience: staff
visibility: staff
locale: en
version: 2
status: current
updated: 2026-10-05
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/legal-hold
  - apps/admin-web/src/app/(console)/legal-holds
tags: [staff, compliance, legal-hold, retention, preservation]
---

# Legal holds

## What is a legal hold?

A legal hold stops the platform's retention rules from deleting a record. Retention normally
removes data once its period ends; a hold keeps one record, and everything that belongs to it,
until the hold is released.

A hold names one record: a person's account, a workspace, a mission, an assignment or a stored
file. While it is in force, every retention deletion skips what belongs to that record and logs
that the hold kept it.

## When is a legal hold placed?

When data must be preserved regardless of its retention period: a preservation request from an
authority, a dispute, litigation, or an instruction from counsel.

Place a hold only on instruction from the legal escalation owner, never on your own judgement
that something might matter one day.

## Who can place or release a legal hold?

Only staff holding the **compliance** scope. Being staff is not enough: a moderator or a
disputes reviewer cannot place, see or release a hold.

Nobody else can see a hold — not the customer, investigator or agency whose data it is. Telling
someone their data is preserved can tip off the subject of a law-enforcement request.

## How do I place a legal hold?

Choose the kind of record and its id, and write the reason: which request, case or instruction
the hold answers, with its reference. The reason must be at least a sentence.

Hold every record the instruction covers. A hold on an account keeps what retention removes with
that account; it does not reach every mission or file connected to the person. If the request
names a mission, an assignment or a file, hold each one.

A hold on a record that does not exist is refused. Several holds can stand on the same record,
each with its own reason, and each is released on its own.

In the staff console, open **Legal holds** and choose **Place a hold**. If you have just looked a
record up, the form starts with that record filled in.

## How do I release a legal hold?

In **Legal holds**, find the hold — **In force** lists them, newest first, or look the record up —
and choose **Release** on its card. Give a reason saying who confirmed the preservation may end.
Releasing is deliberate and final: a released hold cannot be put back in force, and a hold cannot
be released twice. If preservation is needed again, place a new hold.

Retention applies again to the record from its rule's next run. Releasing does not delete
anything by itself.

## How do I check whether a record is held?

In **Legal holds**, under **Holds on one record**, choose the kind of record, paste its id and
choose **Find**. The list then shows only that record's holds; **In force**, **Released** and
**All** switch between them. A record with no holds says so.

Only staff with the compliance scope can open the page. Anyone else in the console sees that the
scope is needed, and nothing about any hold.

## Is a legal hold ever deleted?

No. A hold is kept after it is released, and after the accounts it names or that placed it are
deleted. What was held, why, by whom and when is the record a court or a regulator will ask for.

## What is recorded when I place or release a hold?

Each placement and release is audited with who did it and which record it concerns. The reason
you write stays on the hold itself, which only compliance staff can read; the audit log does not
repeat it, because a reason can name a case or a person.

Each time retention runs and a hold keeps something back, that is recorded against the hold too.

## Does opening a dispute place a hold automatically?

Not yet. Disputes are not built; when they are, opening one will place a hold automatically, and
resolving it will not release that hold. Until then, a hold for a dispute is placed by hand.
