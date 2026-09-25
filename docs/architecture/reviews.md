# Reviews

A customer's rating of a completed assignment, the investigator's one response, and staff moderation
of both. Built in T-037 (plan.md §8). Owner approval, 2026-09-25: the design below, with
**pre-moderation** of all words and discovery ordering left unchanged.

Module: `apps/api/src/modules/reviews`. Tables: `reviews`, `review_texts` (migration 0022).

## The rules, and where each is held

The database holds every rule; the service refuses early with a clear error and shapes what each
reader gets. `test/isolation/reviews.spec.ts` drives the rules with direct writes, so none depends on
the application remembering it.

| Rule | Held by |
|---|---|
| Only the assignment's customer writes a review | RLS `customer_writes` (`customer_tenant_id` copied from the assignment by `fill_party_from_parent`) |
| Only once the assignment is `COMPLETED` | Trigger `check_review` (`review_after_completion`). COMPLETED is terminal, so no lock is needed |
| Exactly once per assignment | Unique index `reviews_one_per_assignment`; the loser of a race gets 409 |
| Rating 1 to 5 | `reviews_rating_range` |
| A review is never rewritten; staff remove it once, with a reason of 20+ characters | Trigger `check_review` (`review_is_kept`), `reviews_removed_in_full`, RLS `staff_removes` |
| The investigator responds once; the customer writes the review's words | RLS `author_writes`, unique index `review_texts_one_per_kind` |
| Every text starts `PENDING` (pre-moderation) | Trigger `check_review_text` (`review_text_starts_pending`) |
| Words are never rewritten, even by staff | `review_text_is_kept` |
| Only staff moderate, and they leave a report as it was | RLS `staff_moderates` under `PlatformContext`, `review_text_moderation_only` |
| The other party may report a published text back to `PENDING`, and change nothing else | RLS `other_party_reports`, `review_text_report_only` |
| Hiding says why | `review_texts_moderated_in_full` |
| A removed review takes no new words | `review_text_on_removed_review` |

## Who reads what

The rating and the words are separate tables so that **row-level security, not a SELECT list,**
decides who reads unmoderated words.

- **Both parties** read their review and both texts in any state (`parties_read`), including a
  hidden text's reason and a removed review, marked removed.
- **Anyone else signed in** reads a rating once the investigator's profile is `PUBLISHED` and while
  the review stands (`reviews.public_read`), and a text only while it is `PUBLISHED` and its review is
  readable to them (`review_texts.public_read`). A draft profile has no visible reviews, so none
  reveals that the profile exists.
- **Staff** read inside `PlatformContext` with the `MODERATION` scope, to moderate.

No view is used: a PostgreSQL view runs with its owner's rights and would sidestep the policies.

The public list (`GET /profiles/investigator/:id/reviews`) also filters on removal and `PUBLISHED`
itself, because a party reading it would otherwise see their own unmoderated words through
`parties_read`. It names no reviewer; a review is attributed to "a customer of that assignment".

## The rating summary

`count` and `average` (two decimals) are computed in SQL from standing reviews on every read. They
are the ranking input reviews provide, and no request can supply them — the DTOs refuse the fields.

**Discovery does not order by them yet.** Changing the order changes who customers see first, which
is gated like T-071 and T-103; it is T-138.

## Routes

| Route | Who |
|---|---|
| `POST /assignments/:id/review` — `{ rating, text? }` | The assignment's customer, once, after COMPLETED |
| `GET /assignments/:id/review` | Either party; 404 for anyone else |
| `POST /assignments/:id/review/response` — `{ text }` | The assignment's investigator, once |
| `POST /assignments/:id/review/report` — `{ part, reason }` | The party who did not write `part` |
| `GET /profiles/investigator/:id/reviews` | Anyone signed in; 404 for a profile they cannot see |
| `GET /review-moderation` | Moderation staff: pending texts, oldest first, with any report |
| `POST /review-moderation/texts/:id` — `{ decision, reason? }` | Moderation staff; `HIDE` needs a reason |
| `POST /review-moderation/reviews/:id/remove` — `{ reason }` | Moderation staff, once |

A review is not a dispute route: it moves no money and reopens nothing, and the create route's
description says so.

## Audit

`review.created` (the rating, and whether words were given), `review.responded`,
`review_text.reported` (the part), `review_text.moderated` (the part and the decision),
`review.removed` (the removal reason). Never the words, which can name people. The report and
moderation reasons are kept on the row, for the moderator and the author respectively.

## Not built here

- Using the rating in discovery ordering — T-138.
- The screens: leaving and reading reviews (T-120, T-122), responding (T-124), the moderation
  console (with T-070's staff console).
- Notifications that a review, response or moderation decision happened — T-036.
