---
id: kb-staff-account-actions
title: Account actions — suspension, deletion and data requests
audience: staff
visibility: staff
locale: en
version: 1
status: current
updated: 2026-09-12
source_of_truth: docs
implementation_status: specified
related_code:
  - apps/api/src/modules/admin
  - apps/api/src/modules/auth
  - apps/api/src/common/audit
tags: [staff, suspension, deletion, data-requests, audit]
---

# Account actions

## What actions can I take on an account?

What your staff scope permits, and no more. Scope is specific: handling disputes does not
carry the ability to suspend, and moderating content does not carry access to payments.

If an action you believe is needed is outside your scope, escalate it rather than asking
someone to run it for you.

## Does every action need a reason?

Yes, and a typed one — the control does not enable without it. The reason is stored with
your identity, the before and after state, and the time.

Write it for someone reading it much later: what you did, to what, and why. "Per policy" is
not a reason.

## When should I suspend an account?

When leaving it active puts customers, their data, or the platform at material risk.
Unlawful work, evidence mishandling, off-platform payment solicitation, credential sharing,
abusive conduct.

Suspension is not a sanction for a poor rating or a lost dispute. Those have their own
consequences.

## What happens to work in progress when I suspend someone?

Assignments do not vanish. Customers with live assignments need an outcome — reassignment,
completion, or refund — and that needs deciding at the time of suspension, not afterwards.

Note in your reason what you did about live assignments. Suspending and leaving customers
stranded converts one problem into several.

## When is a permanent ban appropriate rather than a suspension?

When the violation is substantiated and makes continued participation untenable — not as the
ordinary outcome of a dispute decided against an investigator.

Grounds are in the Terms and in `.claude/skills/enforcement-actions/SKILL.md`. The evidence
standard scales with the consequence: a warning needs a credible report, a precautionary
suspension needs reasonable grounds, **a permanent ban must be substantiated on the balance of
the assignment record** — the accepted quote, the report, the evidence, the messages, the
status history.

A ban resting only on a customer's assertion, with nothing in the record supporting it, is not
substantiated. Send it back for evidence.

## What process must I follow before a ban?

1. Notify the investigator of what is alleged and on what basis, specifically enough to answer
2. Give a real window to respond
3. **Confirm you were not involved** in the underlying complaint or dispute — if you were,
   reassign it
4. Record the decision and its reasoning
5. Tell them the appeal route, to a different reviewer

Skipping notice because a case looks obvious is how a wrong ban becomes a legal problem. If the
account must be stopped immediately, suspend as a precaution and then run the full process.

## Is "negligent" or "inadequate" a judgement I make alone?

It is a judgement, and it is measured against the scope in the accepted quote — the same test
used in dispute handling. Record what you measured it against.

An investigator who honestly reported that something could not be established has performed the
work. That is not inadequacy.

## What about money owed to a banned investigator?

**A ban is not a fine.** Amounts earned for delivered work remain payable. A refund owed to a
customer is a separate determination on its own merits, which may be set against what they are
owed.

Record the two decisions separately. Collapsing them turns a defensible ban into an
indefensible one.

## Can I reverse a suspension?

Where your scope permits, and with a recorded reason, yes. The original action stays in the
record — reversal appends, it does not erase.

If the suspension was wrong, say so in the reversal reason. The record being honest is worth
more than it being tidy.

## How do I handle an account deletion request?

Through the deletion workflow, never by editing records directly. The workflow handles what
must be retained for legal reasons and what is removed.

Some data survives deletion because it must — financial records, and evidence within a
completed assignment where the investigator is also a party. Explain this to the user rather
than promising complete erasure.

## How do I handle a data export request?

Through the export workflow. It is a background job, not an immediate download, because what
the subject is entitled to receive has to be assembled and checked.

Do not assemble an export by hand. A hand-built export risks including another person's data,
which turns a routine request into a breach.

## Can I edit a user's data to correct an error?

Only through the documented correction paths, and only within your scope. Never directly
against the database.

Evidence, reports, audit entries and ledger entries are not editable by anyone, including
staff. Corrections to those are new versions or compensating entries.

## What if I am asked to take an action I think is wrong?

Do not take it, and escalate. The action is recorded against your name, not against whoever
asked.

If the instruction came from outside the normal path — an email, a message, an urgent
request from someone claiming authority — treat that as a reason for suspicion rather than
urgency.
