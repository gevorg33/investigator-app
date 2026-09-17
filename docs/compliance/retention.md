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
| `user_staff_scopes` | With the user; revoked rows kept **7 years** | Dispute defence, incident review | Not deleted on revocation — who could see payments last March is a question an investigation will ask |
| `user_identities` | With the user | — | Cascades. Holds no credential — only the provider's opaque account id |
| `user_tokens` | **30 days** after `expires_at` | Security | Verification and password-reset tokens. Only the hash is stored. Kept past expiry so a redemption attempt on a dead token is still explainable during an abuse investigation |
| `media_assets` | **Per category, provisional:** profile images — with the profile; verification documents — until the verification lapses **+ 12 months** (counsel sets the real period; still listed below) | Contract; verification record | Soft-deleted by the application, which holds no `DELETE`. Removal is one audited retention job that destroys the Cloudinary asset **and** marks the row. The owner key restricts, so no file disappears as a side effect of deleting an account. Upload authorizations that expire are kept **30 days** for abuse investigation |
| `service_areas` | With the profile; removed when the investigator deletes the area | Contract | Cascades from the profile. Holds no home location, and no centre more precise than about a kilometre (migration 0006 constraints). The declared country, region and city (migration 0008) describe where the investigator **works**, not where they live, and are what the country and city filters in discovery match on |
| `missions` | **7 years** after the mission closes — completed, cancelled, rejected or expired (provisional) | Contract, dispute defence | The application holds no `DELETE`. A mission carries history and later quotes and money, so removal is one audited retention job, never a side effect of closing an account. A mission's location is stored no more precisely than about a kilometre (migration 0007 constraints) |
| `mission_status_history` | With the mission | Dispute defence | Append-only — the application holds no `UPDATE` or `DELETE`. Holds the customer's own free-text reasons; no other content |
| `mission_screenings` | With the mission | Lawful-use accountability | Append-only. The record that screening ran, what it flagged, and under which ruleset version — the evidence a policy decision can be reviewed against |
| `outbox_events` | Published rows pruned **30 days** after delivery; unpublished rows never pruned | Operational | Holds references only — ids, statuses, versions — never content. An unpublished row is undelivered work, so a prune that removed one would lose an event |
| `quotes` | With the mission it was offered on (**7 years** after it closes, provisional) | Contract, dispute defence | The application holds no `DELETE`. A quote is the offer as it stood — "what is not in it was not agreed" — so it outlives the decision whether or not it was accepted. Withdrawn and expired quotes are kept too: they are the record of what was available when the customer chose |
| `assignments` | **7 years** after the assignment closes (provisional) | Contract, dispute defence, tax | The application holds no `DELETE`. Holds the agreed terms snapshotted from the quote and the provider's payment reference, so an assignment can always be traced to the authorization that created it. Counsel sets the real period alongside the payment records it relates to |
| `assignment_status_history` | With the assignment | Dispute defence | Append-only — the application holds no `UPDATE` or `DELETE`. Holds the investigator's or customer's own free-text reasons, including the ground given for a policy refusal; no other content |
| `idempotency_keys` | **24 hours minimum** (docs/api/idempotency.md); pruned by a retention job thereafter | Operational, duplicate-payment defence | The application holds no `DELETE` — deleting a key early would let a replay execute a second time, which on quote acceptance means a second agreement. Stores a **hash** of the request, never the request, plus the response that was returned |
| `audit_logs` | **7 years** | Legal obligation, dispute defence | **Never deleted by the application.** A privileged job only, itself audited |

## Still to decide — blocked on counsel

Each will be added as its table ships:

evidence items · reports and versions · verification documents ·
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
