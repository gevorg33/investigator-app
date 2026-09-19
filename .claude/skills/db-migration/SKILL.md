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

## Triggers (since T-074)

Allowed for **invariants the database must hold whoever the writer is**: registration, a script,
a fixture, a bug. Never for business workflows, which belong in services.

- **Invoker's privileges, never `SECURITY DEFINER`**, and a fixed `SET search_path = pg_catalog,
  public`. A spec asserts both for every trigger function.
- **Name the rule in the message** (`RAISE EXCEPTION 'rule_name: …' USING CONSTRAINT = 'rule_name'`).
  A custom `CONSTRAINT` only sets the error's field, so without the name in the message, logs and
  tests cannot see which rule refused.
- **Deferred (`DEFERRABLE INITIALLY DEFERRED`) when a legitimate transaction passes through an
  invalid state**, such as moving ownership. A count-then-decide check **locks the parent row
  first** (`FOR UPDATE`), or concurrent writers each see the other's uncommitted state and both
  commit. Prove the lock with a test that forces the overlap: both check, then both commit.
- **Backfill before creating row-level checks,** then assert the invariant once, set-based
  (`DO $$ … RAISE …`). Row triggers firing once per backfilled row took over five minutes on 40k
  users; set-based took one second.
- **Test with direct writes**, as the owner, bypassing the application.

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

## Tenant-scoped tables (ADR-0011)

Every new table is classified first. A tenant-owned or two-party table ships in the same
migration with:

- the tenant or party columns, defaulting to `app_current_tenant()`
- `ENABLE` and `FORCE ROW LEVEL SECURITY`, and the class's policy with `USING` and `WITH CHECK`
- grants and REVOKEs for `investigator_app`
- an index led by the tenant or party column

A policy must never join a table whose policy joins back. Procedure: `tenant-isolation`.

## Checklist

- [ ] Down path written and correct
- [ ] Expand/contract, not a breaking change in one step
- [ ] No long lock on a large table
- [ ] Backfill is a separate batched job
- [ ] Every index comments its query
- [ ] Delete semantics deliberate; evidence and audit never cascade
- [ ] Retention rule decided for any new table
- [ ] Destructive operations approved by a human
