---
id: kb-staff-review-moderation
title: Moderating reviews and removing them
audience: staff
visibility: staff
locale: en
version: 1
status: current
updated: 2026-09-25
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/reviews
tags: [staff, reviews, moderation, removal, audit]
---

# Review moderation

## What am I moderating?

The words of reviews and of investigators' responses. Ratings are not moderated: they count the
moment they are submitted. Words are **pre-moderated** (owner decision, 2026-09-25): nothing a
customer or investigator writes is public until a moderator publishes it.

Moderation needs the `MODERATION` scope, and every access runs inside platform access and is
recorded.

## What is in the queue?

Words waiting for a decision, oldest first: new reviews, new responses, and published words that the
other party has reported back. A reported item carries the reporter's reason. The rating is shown
beside each item for context.

## When do I publish, and when do I hide?

Publish words that describe the work: timeliness, communication, whether the deliverables matched
the quote, how clearly limitations were stated.

Hide words that name a person — the subject, a witness, the customer, a third party — disclose details
of the case, contain contact details, are abusive, or ask for something the lawful use policy
prohibits. Hiding needs a reason, and the author is shown it, so write it for them: what to leave out,
not what you thought of them.

Harsh but fair criticism of the work is not a reason to hide. Nor is a customer's low rating, or an
investigator's disagreement with it.

## What happens when someone reports published words?

The words go back to pending and leave public view until you decide again. Only the party who did
not write them can report: the investigator reports a review, the customer reports a response. Judge
the words against the same standard as before; a report is a reason to look again, not a verdict.

## When do I remove a whole review?

Rarely. Removal takes the rating and the words out of public view and out of the investigator's
average. Grounds: the review was posted on the wrong assignment, by someone who is not the customer,
or as part of a pattern of abuse or manipulation. A low rating is never a ground.

Removal needs a written reason of at least a sentence, is recorded in the audit log with that reason,
and happens once — it cannot be undone or repeated. Both parties still see the review, marked
removed, with the reason. If the problem is only the words, hide them instead: that leaves an honest
rating standing.

## Can I edit what someone wrote?

No, and nobody can. The words of a review or response are never rewritten; the choice is publish or
hide. If words are acceptable apart from one detail, hide them with a reason that says what to leave
out.

## Does a review move money or reopen an assignment?

No. A customer unhappy with the work is pointed to revisions and disputes; a review does neither. If
a review reads like a dispute that was never raised, the right help is to point the customer at the
dispute route, not to change the review.
