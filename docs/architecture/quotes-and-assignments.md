# Quotes and assignments

How an offer becomes an agreement. Built in T-012, per plan.md §11. The mission side is
`missions.md`; the state-machine procedure is `.claude/skills/mission-state-machine/SKILL.md`.

## The chain

```
investigator submits a quote        → SUBMITTED
customer accepts                    → quote ACCEPTED, siblings CLOSED, mission CUSTOMER_CONFIRMED
payment provider authorizes         → mission PAID → ASSIGNED, assignment created
investigator accepts the assignment → ACCEPTED
```

**Acceptance and assignment creation are different events**, and every document says so:
"an assignment is created only after your acceptance and a successful payment authorization —
until both have happened, no investigator is committed to the work and no assignment exists"
(`kb-customer-quotes-expiry`). Accepting confirms scope and price; it commits nobody to the
work.

## Where this module stops

Assignment creation takes a `PaymentAuthorization` — a reference, an instant, an amount and a
currency — and **nothing here goes looking for one**. The payments module (Phase 5) verifies a
provider webhook and calls `createForAuthorizedPayment` with it in hand, because "an assignment
becomes paid because a verified webhook said so", never because a client callback or a redirect
said so.

There is deliberately **no port with a stub implementation**. A stub that returned a fake
authorization would create real assignments, committing investigators to work nobody paid for.
With no code path that manufactures an authorization, that cannot happen by accident.

Payment intents, signature verification, the ledger, fee splits, refunds, payouts and
reconciliation are **not here**: `payments-webhooks` forbids moving money without a ledger entry
and an audit event in the same transaction, and no ledger exists yet.

## Exactly one assignment, held by the database

Three constraints do the work that a read-then-write check would lose under concurrency:

| Constraint | What it prevents |
|---|---|
| `quotes_one_accepted_per_mission` (partial unique) | Two quotes accepted on one mission |
| `assignments_mission_unique` | A second assignment for a mission |
| `assignments_quote_unique` | A second assignment from one quote |

Plus `quotes_one_live_per_investigator` (partial unique on `SUBMITTED`): one live offer per
investigator per mission, so replacing a quote means withdrawing it first — which is what the
investigator article tells them to do.

There are **two layers**, and they are tested separately because they fail separately.

The service locks the mission `FOR UPDATE` before reading its status, so a second acceptance
waits, finds the mission already `CUSTOMER_CONFIRMED`, and is refused. The constraints hold the
same rule against every *other* writer — a job, a migration, a console, a future endpoint that
forgets to lock.

That distinction was not obvious, and a negative control is what surfaced it: dropping
`quotes_one_accepted_per_mission` from both the schema and the database left the concurrency
test **passing**, because the row lock alone carried it. The constraint was real defence in
depth but nothing proved it load-bearing. So there are now direct-write tests that bypass the
service entirely and assert the database refuses the second accepted quote and the second
assignment — and with those in place, removing the index fails exactly one test, as a control
should.

Tested, then: two acceptances and two authorizations fired simultaneously through the service —
exactly one survives each, and the loser leaves nothing behind — plus the constraints asserted
directly against raw writes.

## Idempotency

Quote acceptance and assignment creation both take a key and are safe to call twice
concurrently (docs/api/idempotency.md). Enforced by a unique index on
`(actor_id, endpoint, key)` — **not** a read-then-write check, which has a race window and
loses under exactly the concurrency it exists to handle.

- **Replay, same body** → the stored response, not a second effect.
- **Replay, different body** → `IDEMPOTENCY_KEY_REUSED`. A key bound to one request must never
  execute a different one.
- **Replay while the first is still running** → a retryable conflict, never queued or run twice.
- **The first call rolled back** → the key rolled back with it, so a legitimate retry works.

The key row and the effect commit in the **same transaction**. The request is stored as a hash,
never as the request itself, using the same canonical-JSON fingerprint search cursors use.

A webhook has no user, so system operations key against a reserved actor id: provider retries
collide with each other, which is the point, and with nobody else.

## The assignment state machine

A **separate machine** from the mission's, as the skill requires — a payment can fail while the
mission sits in `CUSTOMER_CONFIRMED`, and a policy halt is an assignment-level event with no
mission meaning.

```
PENDING_ACCEPTANCE → ACCEPTED → IN_PROGRESS → REPORT_SUBMITTED → COMPLETED
        ↓ decline / window closes      ↓ policy halt        ↓ revisions
    CANCELLED                      SUSPENDED            IN_PROGRESS
```

No document enumerated these states; this is the smallest set covering what the knowledge base
already promises, and **adding one is a plan change, not a code change**. The map is data, the
exhaustive matrix is generated from it — 7 × 7 × 9 = 441 triples, every unlisted one asserted
refused — and properties are asserted over the whole map rather than edge by edge:

- Only the investigator accepts; only the customer completes.
- The system's only move is closing an assignment nobody accepted in time.
- A policy halt is available from both windows **after** acceptance and never before —
  "accepting does not trap you: if you discover the problem at hour twenty, you can stop".
- Only a moderator lifts a suspension.

`AssignmentTransitionService` is the one writer of the status, and a static test fails the build
if anything else writes it. It writes status, history, audit and outbox in the caller's
transaction, guarded by the version and status that were read.

## Policy refusal and halt (T-050)

The refusal right the Terms grant (§3, §4), in two windows because payment precedes acceptance.

| | Window 1 — decline | Window 2 — halt |
|---|---|---|
| From | `PENDING_ACCEPTANCE` | `ACCEPTED`, `IN_PROGRESS` |
| To | `CANCELLED` | `SUSPENDED` |
| Review | only when `reasonCode` is `POLICY_CONCERN`, of kind `DECLINE` | always, of kind `HALT` |
| Money | `FULL_REFUND`, on every investigator decline | `HOLD` |

`policy_reviews` holds the ground and staff's decision on it: **finding** (substantiated or not),
**bad faith** (only with unsubstantiated), and for a halt a **disposition** — `RESUME` moves
`SUSPENDED → IN_PROGRESS` with money `RESUME`; `CANCEL` moves `SUSPENDED → CANCELLED` with a money
decision staff give (`FULL_REFUND`, `SPLIT`, `HOLD`). Every move goes through the transition service.

**Money is recorded, not moved.** `money_decisions` is append-only; the latest row is in force;
`executed_at` is set once, by payments (T-110 to T-113). A `SPLIT` can never exceed the price — the
service says so, and a trigger holds it.

**The response record** (`PolicyRefusalService.recordOf`): counted = investigator declines with no
substantiated or pending policy review, plus unsubstantiated halts; excused = substantiated
reviews; pending = open reviews; bad faith = its own count, which enforcement will read (T-049).

**Privacy.** The ground never reaches the customer: the assignment's history records only the reason
code for a policy decline, and the customer's workspace cannot read `policy_reviews`. Both parties
read `money_decisions`.

**Row-level security.** The investigator's workspace raises and reads reviews, and records only
`FULL_REFUND` or `HOLD`; only staff inside PlatformContext decide a review, record any other money
decision, or mark one executed. Triggers keep what was raised unrewritten, decide a review once, and
never change a money decision beyond marking it executed.

**Staff routes.** `GET /policy-reviews` (open, oldest first, with each raiser's record) and
`POST /policy-reviews/:id/resolve`, under MODERATION and purposes `policy_review.queue` and
`policy_review.resolve`.

## The terms are snapshotted, not joined

An assignment copies the scope, deliverables, assumptions, exclusions, cancellation terms,
price, currency and duration from the quote at creation. The quote is the agreement **as it
stood when it was accepted**; reading the terms back through a mutable row would let a live
assignment's terms change underneath it.

## Who may quote

Published, `VERIFIED` and accepting work — the same conditions discovery applies, checked
against the investigator's own profile. Someone who cannot be found in a search should not be
able to arrive through the back door of a quote. The mission must be one a moderator has
published; a draft mission answers 404, because it is not visible to investigators at all.

## Expiry is enforced against the clock

A quote carries its own expiry, and "once a quote expires it cannot be accepted or reinstated".
Acceptance checks the instant rather than trusting a status column, because time passes without
anyone writing a row.

`quotes_expiry_after_creation` refuses a quote whose expiry is not after its creation — an offer
nobody could ever accept. Worth knowing when writing tests: a CHECK is evaluated on **every**
write, not only on insert, so a lapsed quote is made by ageing both timestamps, the way time
actually produces one.

## The acceptance window

An investigator has **48 hours** (provisional — ACTIONS-FOR-ME #15) from payment authorization
to accept. "Failing to accept it releases the customer and counts against your response record."
Enforced against the clock at acceptance, not by a status somebody has to remember to write.

## Grants

| Table | Grant | Why |
|---|---|---|
| `quotes` | S/I/U | No DELETE: the record of what was offered outlives the decision |
| `assignments` | S/I/U | No DELETE: the agreement money was taken against |
| `assignment_status_history` | S/I | Append-only. A history that can be edited settles no dispute |
| `idempotency_keys` | S/I/U | No DELETE: removing a key early would let a replay execute twice |

As in 0007, a `GRANT` alone decides nothing — migration 0000's default privileges hand out
UPDATE and DELETE on every new table, so withholding a privilege means `REVOKE`ing it.
