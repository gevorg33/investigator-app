---
name: mission-state-machine
description: The mission and assignment status model — legal transitions, the transition service, status history, and audit. Use whenever code reads or changes a mission or assignment status, or when adding a new status or transition.
---

# Mission & assignment state

Statuses (plan.md §8):

```
DRAFT → SUBMITTED → UNDER_REVIEW → QUOTED → CUSTOMER_CONFIRMED → PAID
      → ASSIGNED → ACCEPTED → IN_PROGRESS → REPORT_SUBMITTED
      → CUSTOMER_REVIEW → COMPLETED
```

Terminal or lateral: `CANCELLED`, `REJECTED`, `DISPUTED`, `SUSPENDED`, `EXPIRED`.

## The one rule

**Never assign a status field.** Every change goes through the transition service, which
in a single transaction:

1. Validates the transition is legal from the current status
2. Validates the actor may perform *this* transition
3. Writes the new status
4. Writes a `status_history` row (from, to, actor, reason, timestamp)
5. Emits the audit event
6. Publishes the domain event through the outbox

A status written outside this path has no history and no audit trail, which makes a
dispute unresolvable.

## Declare transitions as data

```ts
const MISSION_TRANSITIONS: TransitionMap = {
  DRAFT:              { SUBMITTED: ['customer'], CANCELLED: ['customer'] },
  SUBMITTED:          { UNDER_REVIEW: ['system'], REJECTED: ['staff'] },
  UNDER_REVIEW:       { QUOTED: ['system'], REJECTED: ['staff'], SUSPENDED: ['staff'] },
  QUOTED:             { CUSTOMER_CONFIRMED: ['customer'], EXPIRED: ['system'], CANCELLED: ['customer'] },
  CUSTOMER_CONFIRMED: { PAID: ['system'], CANCELLED: ['customer'] },
  // ...
  COMPLETED:          {},   // terminal
};
```

Data, not `if` chains. The map is the specification, it is testable exhaustively, and it
is readable by someone resolving a dispute.

## Test exhaustively, both directions

For every status pair, assert either "allowed for role R" or "rejected". Generate the
matrix from the map — do not hand-write the legal cases and forget the illegal ones. The
illegal ones are the test.

```ts
for (const from of ALL) for (const to of ALL) {
  const allowed = MISSION_TRANSITIONS[from]?.[to];
  if (!allowed) it(`rejects ${from} -> ${to}`, ...);
}
```

## Concurrency

Two actors can act on one mission simultaneously — a customer cancelling while a payment
webhook confirms. Guard with an optimistic version column or `SELECT ... FOR UPDATE` on
the mission row. A transition that read a stale status must fail, not overwrite.

## Policy refusal — two windows

An investigator may refuse work on lawful grounds (T&C §3, §4). Because payment precedes
acceptance, there are two distinct windows and they behave differently.

### Window 1 — `ASSIGNED`, before accepting

```
ASSIGNED ──decline(reason)──► CANCELLED
```

No work has been done and the customer has already paid, so the refund is clean and automatic.
A `POLICY_CONCERN` reason additionally opens a staff review of the mission itself — the
material that worried this investigator will worry the next one.

### Window 2 — `ACCEPTED` or `IN_PROGRESS`, after committing

```
ACCEPTED | IN_PROGRESS ──policy_halt(reason)──► SUSPENDED ──► resolved | CANCELLED
```

The investigator raises a halt. Work stops, funds stay held, and staff review. Outcomes:
material removed and the assignment resumes; or the assignment is cancelled with the refund
decided on its merits.

**The halt is available at any point**, including after evidence has been produced. An
investigator who discovers at hour twenty that the customer's attachment was unlawfully
obtained must be able to stop, not be trapped by having accepted.

### The abuse vector — do not make refusal free

A penalty-free exit is an exit people use for other reasons. An investigator who wants out of
an unprofitable assignment will reach for `POLICY_CONCERN`.

So the ground is **reviewed, not asserted**:

| Outcome of staff review | Response record |
|---|---|
| Substantiated | Not counted. The investigator acted correctly |
| Unsubstantiated | Counted, like any other decline or abandonment |
| Bad faith, repeated | Enforcement (`enforcement-actions`) |

That asymmetry is the whole design. Protect good-faith refusal; do not create a free door.

### Money

Window 1 is simple: no work, full refund.

Window 2 is not. Work may have been lawfully performed before the problem surfaced, and the
problem was the customer's material. Whether that work is payable is a determination, not an
automatic consequence — decide it on the assignment record like any other dispute, and record
it separately from the halt itself.

[Counsel question: whether work performed before a customer-caused halt is payable.]

## Cross-machine

Mission status and assignment status are separate machines, as are payment states. Do not
collapse them. An assignment is created only after customer confirmation *and* a valid
payment state — and exactly once, guarded by an idempotency key.

## Adding a status

Adding one is a plan change, not a code change. It needs: the map updated, the exhaustive
test regenerated, every `switch` over statuses reviewed for a missing case (make the
switch exhaustive so the compiler finds them), the UI labels in all three locales, and a
migration if it is persisted as an enum.

## Checklist

- [ ] No direct status assignment anywhere
- [ ] Transition map is data
- [ ] Illegal transitions tested, not just legal ones
- [ ] Status, history, audit and outbox share one transaction
- [ ] Concurrent transition guarded
- [ ] Status switches are exhaustive
