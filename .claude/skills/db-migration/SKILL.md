---
name: db-migration
description: Writing and running PostgreSQL migrations safely — reversibility, the expand/contract pattern, index creation without locks, and the destructive-operation approval gate. Use for any schema change, new table, column, index, constraint or backfill.
---

# Migrations

## Rules

1. **Reversible.** Write the down path and mean it. If the change cannot be reversed, it
   is destructive — stop and get human approval.
2. **Never edit an applied migration.** Add a new one. Editing breaks every environment
   that already ran it.
3. **One concern per migration.** A failed multi-concern migration leaves an ambiguous
   state.
4. **Never run against a non-local database.** Staging and production migrations are run
   by a human, with a fresh verified backup, and a written rollback plan.

## Expand / contract

Never a breaking change in one step. Across deploys:

```
1. Expand   — add the new column/table, nullable or defaulted. Deploy.
2. Backfill — batched, resumable, idempotent job. Not inside the migration.
3. Dual-write — write both, read old. Deploy.
4. Switch   — read new. Deploy, observe.
5. Contract — drop the old. Deploy. (Destructive: approval gate.)
```

Collapsing these is how you get downtime or data loss.

## Locks

A migration that takes an `ACCESS EXCLUSIVE` lock on a large table stops the application.

- `CREATE INDEX CONCURRENTLY` — outside a transaction, and it can fail leaving an invalid
  index you must drop and retry.
- Adding a column with a volatile default rewrites the table on older PostgreSQL. Add
  nullable, backfill in batches, then set the default.
- Adding a `CHECK` or foreign key: add `NOT VALID`, then `VALIDATE CONSTRAINT` separately.
  The validation takes a weaker lock.
- Set a `lock_timeout` so a migration fails fast instead of queueing behind a long query
  and blocking everything behind it.

## Backfills

In the application, not the migration. Batched, resumable, idempotent, rate-limited,
with progress logged. A backfill that must complete before the next deploy is stated in
the handoff.

## Constraints

Foreign keys everywhere, with deliberate delete semantics:

- Evidence, reports, audit rows, ledger entries: **never** cascade-deleted. Retention is
  policy, enforced by a job, audited.
- Join rows and derived data: cascade is usually right.
- Anything user-facing: restrict, and handle the error meaningfully.

## Indexes

Every index names the query it serves, in a comment. No speculative indexes — each one
costs write throughput and storage.

```sql
-- Serves InvestigatorRepository.findEligibleNear():
-- filters verification_status + specialty, orders by ST_Distance.
CREATE INDEX CONCURRENTLY idx_investigator_eligible
  ON investigator_profiles (verification_status, specialty_id)
  WHERE deleted_at IS NULL;
```

## Approval gate

These stop and ask, every time: dropping a column or table, truncating, altering a type
in a way that loses precision, removing a constraint, any data-rewriting update, anything
touching `audit_logs` or ledger tables.

## Checklist

- [ ] Down path written and correct
- [ ] Expand/contract, not a breaking change in one step
- [ ] No long lock on a large table
- [ ] Backfill is a separate batched job
- [ ] Every index comments its query
- [ ] Delete semantics deliberate; evidence and audit never cascade
- [ ] Retention rule decided for any new table
- [ ] Destructive operations approved by a human
