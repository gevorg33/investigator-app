---
description: Create a reversible PostgreSQL migration
argument-hint: "<what the schema change does>"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

Load the `db-migration` skill. Migration: $ARGUMENTS

Before writing:

1. Read the current schema and the most recent migrations. Never edit an applied one.
2. State whether this is expand, backfill, switch or contract. If it is a breaking change
   in one step, split it.
3. Identify any lock risk on a populated table and how you avoid it.
4. If it drops, truncates, rewrites data, removes a constraint, or touches audit/ledger
   tables — **stop and ask for human approval before writing it.**

Write:
- The migration with a correct, tested down path
- Every index commented with the query it serves
- Deliberate delete semantics on foreign keys — evidence and audit rows never cascade

Then report: filename, tables and indexes touched, the down path, whether a separate
batched backfill job is required before the next deploy, and the retention rule for any
new table.

Do not run the migration against anything but a local database.
