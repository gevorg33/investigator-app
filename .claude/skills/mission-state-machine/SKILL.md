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
