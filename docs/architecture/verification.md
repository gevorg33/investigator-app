# Investigator verification

How an investigator comes to be verified. Built in T-013 (API only), per plan.md §23. The
staff console that uses these endpoints is T-070. The KB articles are
`kb-investigator-verification` and `kb-staff-verification-review`.

## The flow

```
investigator uploads VERIFICATION_DOCUMENT files      (media module, T-008)
investigator submits an application                   → request SUBMITTED, profile PENDING*
reviewer reads the queue, the application, the trail
reviewer opens documents                              → each opening audited, per application
reviewer decides, whole, with a reason                → request APPROVED | REJECTED
                                                        profile VERIFIED | REJECTED*
```

\* A profile that is already VERIFIED stays VERIFIED through a later application and through a
rejection of it: "your existing verified scope is unaffected" while additions are reviewed. An
approval of a later application keeps the original `verified_at`, because that column records
when the current verification was granted.

## Endpoints

| Route | Who | Does |
|---|---|---|
| `POST /verification/me/requests` | INVESTIGATOR | Apply with `documentIds` (1–10) |
| `GET /verification/me/requests` | INVESTIGATOR | Own applications, newest first, with decision reasons |
| `GET /verification/requests` | STAFF · VERIFICATION | Open queue, oldest first, cursor-paginated |
| `GET /verification/requests/:id` | STAFF · VERIFICATION | Application, document metadata, profile, full decision trail |
| `POST /verification/requests/:id/decision` | STAFF · VERIFICATION | `{ outcome: APPROVED \| REJECTED, reason }` |
| `GET /verification/requests/:id/documents/:assetId/delivery-url` | STAFF · VERIFICATION | Five-minute link to one document of one application |

Reviewer routes call `requireRole(STAFF)` as well as `requireStaffScope(VERIFICATION)`: someone
who is staff and an investigator, working as the investigator, is not a reviewer at that moment.

## Rules, and what holds each one

| Rule | Held by |
|---|---|
| `investigator_profiles.verification_status` changes only here | `verification-status-writes.spec.ts` scans the source for any other writer |
| The declaration a reviewer checks against does not move | Snapshotted into `declared_scope` at submission; read from the profile, never from the client |
| One open application per profile | Partial unique index `verification_requests_one_open_per_profile`; the profile row is locked during submission |
| A request is decided once | Row lock + an UPDATE matching status and version; unique `verification_decisions_one_per_request` |
| Nobody decides their own application | `stateAllows` in `decide` (403) |
| A decision always has a reason | DTO (`\S`, ≤ 2000) and CHECK `verification_decisions_reason_present` |
| Status and decision time agree | CHECKs `verification_requests_decided_at_consistent` and `_decided_after_submitted` |
| Decisions and document lists cannot be rewritten | Application role holds SELECT, INSERT only; requests have no DELETE |
| Documents are the applicant's own, finished, not known-bad | Owner-scoped query; READY required; INFECTED/FAILED refused; a scan still PENDING is accepted |
| A reviewer only opens clean files | Opening goes through `MediaService.getDeliveryUrl`, which requires READY + CLEAN |

## Decision time: the database's clock, never before the submission

`decided_at` is set in the UPDATE as `greatest(now(), submitted_at)`, and every other timestamp
of the decision is taken from what that UPDATE returned. Two failures got it here:

1. Timed by the application server, a clock slightly behind the database's produced decisions
   timed before their own submission.
2. Timed by the database's `now()` alone, the full suite still produced one: the dev database's
   clock stepped back 74 ms between a submission and its decision. Wall clocks are not
   monotonic, so even two readings from one server can run backwards.

The CHECK `verification_requests_decided_after_submitted` stays as the backstop; the
regression test times a submission an hour ahead of the deciding transaction.

## Auditing

| Action | When |
|---|---|
| `verification.submitted` | Application created (actor INVESTIGATOR) |
| `verification.approved` / `verification.rejected` | Decision recorded, same transaction (actor STAFF) |
| `verification.document_opened` | A reviewer opened a document; `resource_id` is the application, `reason` the asset |
| `media.delivered` | Written by the media module for the same opening |

Every denial is audited by `AuthzService`, as everywhere else.

## The console (T-070)

The reviewer screens are in admin-web (`admin-web.md`, "Verification"): the queue, one application
with the recorded declaration and the trail, documents opened only through the audited per-application
route, and the decision form. Nothing in the console decides who may review: every screen shows what
the API answers, and 403 is shown as a missing scope.

## Not built — and filed

- **Scope-level verification (T-071).** Verification is profile-wide. Partial approval, review of
  individual additions, and discovery/quoting honouring verified scope all need verification
  tracked per specialty and area. Until then a verified investigator's later additions are live
  without review; the KB says review of additions is not built.
- **Document expiry and lapse, renewal reminders, required documents per jurisdiction (T-072).**
- **Decision notifications** — no notification channel exists yet.
- **The staff console (T-070)**, with T-014's component library.
