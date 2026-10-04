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
| `oauth_attempts` | **1 day** after the attempt, or its waiting sign-up, lapses | Security | A sign-in with Google (T-062). Only hashes of state, nonce and sign-up token. The provider address is held only while a first sign-in waits for the documents (thirty minutes). Deleted by the hourly retention sweep (`retention.oauth_attempts`, T-204), through the retention guard: a LINK attempt whose account is under a legal hold is kept until the hold is released (T-035) |
| `user_tokens` | **30 days** after `expires_at` | Security | Verification and password-reset tokens. Only the hash is stored. Kept past expiry so a redemption attempt on a dead token is still explainable during an abuse investigation |
| `media_assets` | **Per category, provisional:** profile images — with the profile; agency logos and covers — with the agency, and one no longer named by its profile is removed by the retention job **30 days** after it was replaced (T-084); verification documents — until the verification lapses **+ 12 months** (counsel sets the real period; still listed below) | Contract; verification record | Soft-deleted by the application, which holds no `DELETE`. Removal is one audited retention job that destroys the Cloudinary asset **and** marks the row. The owner key restricts, so no file disappears as a side effect of deleting an account. Upload authorizations that expire are kept **30 days** for abuse investigation |
| `service_areas` | With the profile; removed when the investigator deletes the area | Contract | Cascades from the profile. Holds no home location, and no centre more precise than about a kilometre (migration 0006 constraints). The declared country, region and city (migration 0008) describe where the investigator **works**, not where they live, and are what the country and city filters in discovery match on |
| `missions` | **7 years** after the mission closes — completed, cancelled, rejected or expired (provisional) | Contract, dispute defence | The application holds no `DELETE`. A mission carries history and later quotes and money, so removal is one audited retention job, never a side effect of closing an account. A mission's location is stored no more precisely than about a kilometre (migration 0007 constraints) |
| `mission_status_history` | With the mission | Dispute defence | Append-only — the application holds no `UPDATE` or `DELETE`. Holds the customer's own free-text reasons; no other content |
| `mission_screenings` | With the mission | Lawful-use accountability | Append-only. The record that screening ran, what it flagged, and under which ruleset version — the evidence a policy decision can be reviewed against |
| `mission_moderation_decisions` | With the mission | Lawful-use accountability, dispute defence | Append-only — the application holds no `UPDATE` or `DELETE` (T-051). Each moderator decision: the outcome, the reason the customer reads, an internal note the customer never does, the moderator, and the category, band and queue time review latency is measured by. Read by staff only |
| `mission_tags` | With the mission | Contract | A mission's tags (T-055): suggested by the customer, confirmed by a moderator. Ids and times only — the vocabulary (`tags`, `tag_labels`) is platform data, never deleted, only deprecated or merged. A customer may withdraw an unconfirmed suggestion from their own draft; nothing else deletes a row |
| `outbox_events` | Published rows pruned **30 days** after delivery; unpublished rows never pruned | Operational | Holds references only — ids, statuses, versions — never content. An unpublished row is undelivered work, so a prune that removed one would lose an event |
| `job_runs` | **90 days** after the run *(provisional)* | Operational | The idempotency record (T-082): what a job did, and in which workspace. Past the longest a queue could redeliver a job, it has nothing left to guard. No content — a job's key, its command and when. Not swept yet: the scheduled sweep exists (T-204), and this rule joins it when its period stops being provisional |
| `job_dead_letters` | **90 days** after failure *(provisional)* | Operational | A job that failed for good (T-082), kept whole — its context and payload, which hold ids, never content — so it can be read and replayed. Replay and pruning arrive with T-168 |
| `notifications` | **12 months** after it was created *(provisional)*, and with the recipient | Contract | A kind, a subject id and a relative link — never content (T-036). Cascades with the user. Not swept yet: the scheduled sweep exists (T-204), and this rule joins it when its period stops being provisional |
| `notification_preferences` | With the user | Consent record | A choice about email, kept while the person is — deleting one would switch their email back on. Cascades with the user. The change itself is in `audit_logs` |
| `user_blocks` | Until the blocker removes it; with either person *(provisional)* | Safety, the blocker's choice | Deleted on unblock; cascades with either account. Who blocked whom, and when, stays in `audit_logs` (`user.blocked`, `user.unblocked`) for staff's pattern review. The label is a name the blocker could already see |
| `quotes` | With the mission it was offered on (**7 years** after it closes, provisional) | Contract, dispute defence | The application holds no `DELETE`. A quote is the offer as it stood — "what is not in it was not agreed" — so it outlives the decision whether or not it was accepted. Withdrawn and expired quotes are kept too: they are the record of what was available when the customer chose |
| `assignments` | **7 years** after the assignment closes (provisional) | Contract, dispute defence, tax | The application holds no `DELETE`. Holds the agreed terms snapshotted from the quote and the provider's payment reference, so an assignment can always be traced to the authorization that created it. Counsel sets the real period alongside the payment records it relates to |
| `assignment_status_history` | With the assignment | Dispute defence | Append-only — the application holds no `UPDATE` or `DELETE`. Holds the investigator's or customer's own free-text reasons, including the ground given for a policy refusal; no other content |
| `idempotency_keys` | **24 hours minimum** (docs/api/idempotency.md); pruned by a retention job thereafter | Operational, duplicate-payment defence | The application holds no `DELETE` — deleting a key early would let a replay execute a second time, which on quote acceptance means a second agreement. Stores a **hash** of the request, never the request, plus the response that was returned |
| `verification_requests` | With the verification documents it was made with (**until the verification lapses + 12 months**, provisional) | Contract; verification record | The application holds no `DELETE`. Holds a snapshot of the specialties and service areas declared at submission — taxonomy ids and area labels, never geometry |
| `verification_request_documents` | With the request | Verification record | Append-only — the application holds no `UPDATE` or `DELETE`. Links only; the files themselves follow the `media_assets` rule |
| `tenants` | **Personal:** with the user; removed with them by the retention workflow when empty. **Agency:** through its lifecycle (T-090); never hard-deleted while anything it holds is retained | Contract, dispute defence | The application holds no `DELETE`. Kind and owner never change (trigger) |
| `tenant_profiles` | With the agency (T-090's lifecycle); unpublished rather than deleted | Contract | The application holds no `DELETE`. Holds only what the agency chose to show publicly. Its logo and cover follow the `media_assets` rule (T-084) |
| `tenant_settings` | With the agency | Contract | The application holds no `DELETE`; a section goes back to its defaults by saving them. Records who last saved each section, by id without a foreign key, as in `audit_logs` (T-084) |
| `tenant_memberships` | With the workspace; a REMOVED membership is kept, so attribution survives | Contract, dispute defence, audit | The application holds no `DELETE`. Workspace and person never change (trigger). An agency membership blocks the user's hard deletion, and the retention workflow handles it deliberately. Job title, department and locale/time zone overrides (T-085) go with the row; a REMOVED member's roles are deleted, their details kept for attribution |
| `tenant_invitations` | **Provisional:** with the agency, as the record of who was asked and by whom; the **invitee's address** is personal data of someone who may never have joined — see below (T-085) | Contract (the agency's request to add a member), audit | The application holds no `DELETE`. Stores the token's hash only, never the token. A PENDING invitation expires after 7 days (derived, nothing runs); cancelled and expired rows stay |
| `teams` | With the agency; deleted when the agency deletes it (T-086) | Contract | Holds a name and a description the agency wrote. Deleting a team takes its `team_members` rows |
| `team_members` | While the person is a member and the team exists: removed from the agency, they leave every team (trigger) (T-086) | Contract | Ids only. The application holds no `UPDATE` |
| `membership_roles` | With the membership | Audit | Assignments are added and removed, never edited in place. The last OWNER cannot be removed (trigger) |
| `permissions`, `roles`, `role_permissions` | Indefinitely — reference data | Contract | Seeded by migration. Read-only to the application. Contain no personal data |
| `verification_decisions` | With the request | Verification record, dispute defence | Append-only. The reviewer is recorded by id without a foreign key, as in `audit_logs`, so attribution survives the reviewer's account. The reason is free text written for the applicant |
| `legal_holds` | **Indefinitely** — released holds included | Legal obligation, dispute defence | Never deleted by anyone: a trigger refuses DELETE even to the owner, and the application holds no `DELETE` (migration 0041). Released once, with its own reason, and otherwise never changed. The resource and the people are not foreign keys, so a hold survives the account it names and the account that placed it (T-035). If released holds are ever given a period, the migration that sets it lifts the trigger |
| `audit_logs` | **7 years** | Legal obligation, dispute defence | **Never deleted by the application.** A privileged job only, itself audited |
| `ai_sessions` | **Until the user deletes it**; a deleted session is kept as a tombstone — owner, workspace and deletion time, no title, no content — for the life of the account (provisional) | Contract; audit | Deleting erases every message in the same transaction (owner decision, 2026-09-23). The application holds no `DELETE` on sessions, so the tombstone cannot be removed by it. Readable only by its own user in its own workspace — not an agency's owner (T-045) |
| `reviews` | **With the assignment** (**7 years** after it closes, provisional). A removed review is kept, hidden, with who removed it and why | Contract, dispute defence | The application holds no `DELETE`. Rating only; the review is never rewritten (trigger), and staff removal is the one change. When the customer's account is deleted the review stays, attributed to "a customer of that assignment" — it carries no customer name, and the assignment it points to is readable only by its parties (T-037) |
| `review_texts` | **With the review** | Contract, dispute defence | The application holds no `DELETE`. The words of a review and of the investigator's response, never rewritten (trigger); moderation and reports change only the status and say who and why. Can name people, which is why nothing unmoderated is readable outside the two parties and staff |
| `ai_messages` | **With the session**: erased the moment it is deleted | Contract | Append-only by trigger. The application holds `DELETE` here and nowhere near it, used only by session deletion, which walks every table that references a session. Messages can name people who are not users, which is why deletion erases rather than hides (T-045). From T-056 they hold the questions people ask the assistant and its answers, with the sources' titles — which T-017 kept nowhere; the audit row still records only which documents were used. From T-059 an assistant reply can be a discovery answer — investigators' public projections (name, headline, languages, specialties, declared hours, distance rounded up to whole km) as they were when found; a location the person shared is used for that search and stored nowhere |
| `ai_plans`, `ai_plan_steps` | **With the session**: erased the moment it is deleted (provisional) | Contract; the confirmation record is the audit trail | What the assistant proposed to do, the person's confirmation and how far it ran (T-048). A step holds the tool's arguments as proposed — they can be the person's own words — and the tool's output projection. The application holds `DELETE` only for session deletion. The **fact** of a proposal, a confirmation, a decline and an outcome is in `audit_logs` (7 years) with the tools' names and reason codes, never the arguments, so it outlives the plan without its content |
| `ai_tool_results` | **With the session**: erased the moment it is deleted (provisional) | Contract | A tool's result too large for a prompt, kept whole and read a page at a time (T-048). Holds what the tool returned to its caller — for discovery, investigators' public projections. Written once (trigger); nothing stores one until the orchestrator does (T-095) |

## Still to decide — blocked on counsel

Each will be added as its table ships:

invitation addresses of people who never joined (T-085) · evidence items · reports and versions ·
verification documents ·
messages and attachments · payment and ledger records · consent records · AI sessions, messages
and memory · investigation sources, notes, tasks and documents · ban identity hashes

Two that need particular care:

- **Consent records survive account deletion** by design — they are the proof of the basis on
  which processing occurred (`legal-consent`). **Built in T-021:** `user_consents.user_id` is
  deliberately not a foreign key, so deleting a user leaves the rows standing (tested), and the
  application role holds no `UPDATE` or `DELETE` on the table. The document a row names cannot be
  deleted either, and cannot be edited once published — a record that points at text somebody
  later changed proves nothing.
- **Ban identity hashes survive account deletion** or a ban is defeated by deleting and
  re-registering (`enforcement-actions`). Lawful basis is counsel question §19a.

## Rules that do not depend on the periods

1. **Legal hold overrides retention.** An open dispute or preservation request blocks deletion
   (T-035). Every deletion path checks first — see "How a legal hold works" below.
2. **Evidence and audit rows are never cascade-deleted.** Retention is policy enforced by a
   job, not a foreign-key side effect.
3. **Deletion is audited**, including retention deletion.
4. **A shortened period is not applied retroactively** without a recorded decision — it may
   destroy something a dispute needs.

## How a legal hold works

Built in T-035. A **legal hold** names one resource — a person's account, a workspace, a mission,
an assignment or a stored file — and says why it must be preserved: a preservation request, a
dispute, litigation, counsel's instruction. While it is in force, retention deletes nothing that
belongs to that resource.

- **Who:** staff holding the `COMPLIANCE` scope place, list and release holds — in the staff
  console under **Legal holds** (T-205), on `/api/v1/legal-holds` — each call its own audited crossing into `PlatformContext`. Nobody else
  reads a hold — including the person whose data it is, since telling them can tip off the subject
  of a law-enforcement request (`docs/operations/law-enforcement-requests.md`).
- **Placing** is refused only for a resource that does not exist. Several holds on one resource
  stand independently; each is released on its own.
- **Releasing** is deliberate: its own reason, its own audit row, once. Retention applies again
  from the rule's next run. The audit rows name the hold and what it holds, never the reasons —
  those stay on the hold, which only platform access can read.
- **How retention respects it:** every retention deletion goes through `RetentionGuard.sweep()`.
  The guard refuses to run outside platform access (holds are invisible there, so a sweep that ran
  anyway would see none), deletes only rows no hold in force covers, and audits each hold
  that kept rows back (`retention.kept`, with the rule and the count) and the deletion itself
  (`retention.deleted`) — one transaction, every run. A rule names every resource a row belongs to;
  a hold on any of them keeps the row.
- **Held in the source:** `retention.static.spec.ts` lists every other delete in the API with why it
  is not retention — a person removing their own thing, a set being replaced, derived data rebuilt.
  A new delete fails the build until it is moved into the guard or listed.

**Not built yet, and where it lands:**

| | Where |
|---|---|
| Opening a dispute places a hold automatically; resolving it does not release it | T-118, with disputes |
| A retention job that skips held evidence and reports why | T-116, with evidence items |
| An erasure request against held data is surfaced to compliance, never auto-resolved | T-206, the erasure workflow — which also decides whether a hold stops a person erasing an assistant session |

## How retention runs

Built in T-204. **Each rule is code, in one place**: `apps/api/src/modules/legal-hold/retention-rules.ts`
— the table, the period, how often it runs, and every resource a row belongs to. A period there is
held equal to this register's by `retention-rules.spec.ts`, so neither changes without the other,
and the diff that shortens one is where rule 4's recorded decision shows.

- **On a schedule, in the worker.** When the worker starts it installs a BullMQ scheduler per rule
  on the `maintenance` queue, and removes any for a rule no longer in the code. The schedule lives in
  Redis: however many workers run, each interval queues one sweep. Each run is a system job — one
  audited crossing (`jobs.run_system`), the sweep in the run's transaction, recorded in `job_runs`
  under the run's own key — so a redelivered run does nothing and the next run is its own.
- **Nothing deletes on a request.** The Google sign-in used to purge lapsed attempts when the next
  one started; it no longer deletes anything.
- **The worker must run wherever the API does.** Without it no rule runs, and a waiting sign-up's
  provider address would outlive its day. The server stack runs it beside the API — the `worker`
  service in `infrastructure/compose/server.yml` (T-208).
- **Only rules whose period is settled.** `oauth_attempts` runs (hourly; a day past lapse, a
  security period rather than a legal one). The provisional periods above — `job_runs`,
  `notifications`, `idempotency_keys`, `outbox_events` — are not swept: this register says not to
  build an irreversible deletion against them. Each joins as one entry in `retention-rules.ts` when
  its period is decided.

