# Mission and assignment lifecycle

Reference for the state machine. The authoritative definition is the transition map in code —
see `.claude/skills/mission-state-machine/SKILL.md`. This document explains it; it does not
define it.

## Shape

```
DRAFT ──► SUBMITTED ──► UNDER_REVIEW ──► QUOTED ──► CUSTOMER_CONFIRMED ──► PAID
                                                                            │
   ┌────────────────────────────────────────────────────────────────────────┘
   ▼
ASSIGNED ──► ACCEPTED ──► IN_PROGRESS ──► REPORT_SUBMITTED ──► CUSTOMER_REVIEW ──► COMPLETED
```

Lateral and terminal, reachable from several states: `CANCELLED`, `REJECTED`, `EXPIRED`,
`DISPUTED`, `SUSPENDED`.

## What each state means

| State | Meaning | Who moves it |
|---|---|---|
| `DRAFT` | Private to the customer. Invisible to search and to investigators | customer |
| `SUBMITTED` | Handed in, awaiting policy screening | system |
| `UNDER_REVIEW` | Held for staff policy review | staff |
| `QUOTED` | Visible to eligible investigators; quotes exist | system |
| `CUSTOMER_CONFIRMED` | A quote accepted; payment authorising | customer |
| `PAID` | Payment confirmed **by verified webhook**, never by client callback | system |
| `ASSIGNED` | Assignment created, awaiting investigator acceptance | system |
| `ACCEPTED` | Investigator committed to the scope and price | investigator |
| `IN_PROGRESS` | Work under way | investigator |
| `REPORT_SUBMITTED` | Report delivered and signed | investigator |
| `CUSTOMER_REVIEW` | Customer accepting or requesting revisions | customer |
| `COMPLETED` | Closed; review may be left; payout proceeds | customer / system |
| `DISPUTED` | Paused pending staff determination | customer, then staff |
| `SUSPENDED` | Halted by staff | staff |
| `EXPIRED` | Timed out without an accepted quote | system |

## Boundaries that matter

**Assignment creation is the hinge.** It happens once, after customer confirmation **and**
successful payment authorisation, guarded by an idempotency key with a unique constraint.
Concurrent acceptance must produce exactly one assignment — proven by a concurrency test, not
assumed.

**Mission state and assignment state are separate machines**, as is payment state. Do not
collapse them. A payment can fail while a mission sits in `CUSTOMER_CONFIRMED`.

**Nothing assigns a status field directly.** Every change goes through the transition service,
which validates legality and actor permission, writes the status-history row, emits the audit
event and publishes through the outbox — all in one transaction.

**Concurrency is real.** A customer cancelling while a payment webhook confirms is an ordinary
event. Guard with an optimistic version column or a row lock; a transition that read a stale
status must fail rather than overwrite.

## Where evidence and reports attach

Evidence, sources, notes, tasks and documents belong to the **assignment**, not the mission —
the assignment is the investigation (ADR-0005). They become reachable from `ACCEPTED` onward.

Evidence is immutable once submitted. Reports are versioned; revisions create new versions and
earlier ones are retained. See `evidence-integrity` and `report-generation`.

## Adding a state

A plan change, not a code change. It requires: the transition map updated, the exhaustive
legal/illegal matrix regenerated, every `switch` over statuses reviewed (make them exhaustive
so the compiler finds them), labels in all three locales, and a migration if persisted as an
enum.
