# Data retention

A rule per table, required before any table ships (`db-migration`: never add a table without
deciding its retention rule).

> **Periods below are PROVISIONAL.** They are engineering defaults chosen so nothing ships
> undefined. **Counsel sets the real ones** — `counsel-brief.md` §5 and question 12. Do not
> treat these as legal positions, and do not build an irreversible deletion job against them.

## How deletion works here

Three mechanisms, deliberately distinct:

| | Meaning |
|---|---|
| **Soft delete** (`deleted_at`) | Hidden from the application, still on disk. Reversible |
| **Retention deletion** | A scheduled privileged job removes the row. Audited |
| **Erasure request** | A subject exercises their rights. Runs through the deletion workflow, and is **blocked by a legal hold** (T-035) |

The application role cannot perform retention deletion on `audit_logs` — it holds no `DELETE`
grant (migration 0000, proven by `grants.spec.ts`).

## Register

| Table | Retention (provisional) | Basis | Notes |
|---|---|---|---|
| `users` | Soft-deleted on request; hard-deleted **30 days** after | Contract, then erasure | Financial and evidence obligations may hold rows longer |
| `user_roles` | With the user | — | Cascades |
| `user_sessions` | **90 days** after expiry | Security | Revoked sessions kept for abuse investigation |
| `user_identities` | With the user | — | Cascades. Holds no credential — only the provider's opaque account id |
| `user_tokens` | **30 days** after `expires_at` | Security | Verification and password-reset tokens. Only the hash is stored. Kept past expiry so a redemption attempt on a dead token is still explainable during an abuse investigation |
| `audit_logs` | **7 years** | Legal obligation, dispute defence | **Never deleted by the application.** A privileged job only, itself audited |

## Still to decide — blocked on counsel

Each will be added as its table ships:

evidence items · reports and versions · verification documents · mission descriptions ·
messages and attachments · payment and ledger records · consent records · AI sessions, messages
and memory · investigation sources, notes, tasks and documents · ban identity hashes

Two that need particular care:

- **Consent records survive account deletion** by design — they are the proof of the basis on
  which processing occurred (`legal-consent`).
- **Ban identity hashes survive account deletion** or a ban is defeated by deleting and
  re-registering (`enforcement-actions`). Lawful basis is counsel question §19a.

## Rules that do not depend on the periods

1. **Legal hold overrides retention.** An open dispute or preservation request blocks deletion
   (T-035). Every deletion path checks first.
2. **Evidence and audit rows are never cascade-deleted.** Retention is policy enforced by a
   job, not a foreign-key side effect.
3. **Deletion is audited**, including retention deletion.
4. **A shortened period is not applied retroactively** without a recorded decision — it may
   destroy something a dispute needs.
