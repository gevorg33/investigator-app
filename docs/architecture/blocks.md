# Blocking another user (T-052)

One person refusing **future engagement** with another. Blocking here is not blocking on a social
app: two people may be mid-assignment with money held, evidence exchanged and work owed. So a block
governs what happens next and never ends an obligation. It is **private**: the blocked person is
not told, and nothing they are shown answers differently because of it.

## What a block does

| | Effect | Where it is held |
|---|---|---|
| Discovery | Neither appears in the other's investigator search | `investigatorSearchQuery` eligibility: `ip.user_id <> ALL (app_blocked_users())` |
| Mission browse | An investigator no longer sees the customer's published missions | `missions.quoted_read` policy |
| Quoting | An investigator cannot quote on the customer's missions — not even one still visible through an earlier, withdrawn quote | `quotes.not_blocked` restrictive INSERT policy |
| Accepting | A customer cannot accept a quote from someone they blocked; told why, lifted by unblocking | `QuotesService.accept` — the customer's own block, so theirs to be told about |
| Open quotes | An investigator who blocks a customer has their open quotes to them **withdrawn** — the customer sees an ordinary withdrawal | `BlocksService` follow-through, audited `quote.withdrawn` with reason `blocked` |
| Live assignment | **Untouched.** It continues; both parties can act on it; it goes to disputes staff | `BlocksService` follow-through, audited `block.live_assignment` |

A live assignment is one in `PENDING_ACCEPTANCE`, `ACCEPTED`, `IN_PROGRESS`, `REPORT_SUBMITTED` or
`SUSPENDED`. A test holds that blocking — by either side — leaves the assignment row unchanged and
the investigator still able to accept it (`assignments.service.spec.ts`).

What a block does **not** do: it does not hide an investigator's profile page reached directly, it
does not hide a customer's card from the parties to a live assignment, and it does not touch
messages, which do not exist yet.

## Who is named

A block is made from where the blocker stands — never from a user id, which nothing the app shows
carries:

| Made from | Names | Label kept |
|---|---|---|
| An investigator's published profile | that investigator | their display name |
| A mission the investigator can see | its customer | **none** — a customer is anonymous to investigators until hired |
| An assignment the caller is party to | the other party | their display name |

Anything the caller cannot see is the same 404 as nothing at all. Blocking oneself is refused.
Blocking again is harmless, and finishes a follow-through that failed half-way.

## How it is enforced — `app_blocked_users()`

The blocked person's own browsing and quoting must lose the blocker, yet they must never be able to
read the block. Every visibility rule is a row-level security policy that runs as the person asking,
so migration 0034 adds one function that runs as its owner:

```sql
app_blocked_users() RETURNS uuid[]  -- SECURITY DEFINER, STABLE, fixed search_path
```

It returns the people blocked **either way** with the current user — never who blocked whom — and
takes no argument, so it answers for the current user only. It is the repository's first
`SECURITY DEFINER` (owner decision, 2026-09-30). The application never returns its result; it is
used inside policies and queries, wrapped as `(SELECT app_blocked_users())::uuid[]` so it is
evaluated once per statement, not once per row.

`user_blocks` is FORCEd, and FORCE applies to a table owner that is not a superuser. The
`blocked_set` policy — `FOR SELECT TO` the migration's owner — is what lets the function read.
`test/isolation/blocks.spec.ts` rebuilds that production shape with a non-superuser owner, and
removes the policy as the negative control.

## Data

`user_blocks`: `blocker_id` (DEFAULT the current user), `blocked_id`, `blocked_profile_id` (their
investigator profile then, if any), `tenant_id` (where it was made — it scopes nothing), `source`,
`label` (the name the blocker could see: an investigator's pseudonym — never their legal name, T-181 —
or null; a customer's name only when blocked by the investigator they hired), `created_at`. Unique per (blocker, blocked). Class `system` in the registry.

| Policy | |
|---|---|
| `own_blocks` | The blocker reads and removes their own, from any workspace they are in; makes one in the workspace they are in |
| `blocked_set` | The owner reads every row — for `app_blocked_users()` alone |

Grants: `SELECT, INSERT, DELETE` — made and removed, never edited. Unblocking deletes the row; the
audit trail keeps both (`user.blocked`, `user.unblocked`, resource the other person). Retention:
`docs/compliance/retention.md`.

The follow-through runs in the audited system context (`block.follow_through`), still as the
blocker, because the quotes and assignments it reaches may be in other workspaces.

## API

| Route | |
|---|---|
| `POST /blocks` | `{ investigatorProfileId }`, `{ missionId }` or `{ assignmentId }` — exactly one. Returns the block and `liveAssignments` |
| `GET /blocks` | The caller's own, newest first |
| `DELETE /blocks/:id` | Unblock. Another's id is `NOT_FOUND` |
| `GET /block-review/live-assignments` | Disputes staff: blocks between the parties to a live assignment |
| `GET /block-review/signals` | Enforcement staff: accounts blocked by `BLOCK_SIGNAL_THRESHOLD` (3, provisional) or more people |

## In the app

- An investigator's profile: **Block this investigator**, and once blocked, a note with **Unblock**.
- A mission card in browse: **More actions → Block this customer**. The card goes at once.
- Account → **People you blocked**: each with where it was made, when, and **Unblock**.

Each asks first, in an `AlertDialog` (a sheet on the phone) that says the other person is not told
and work under way is not ended. The result shows at once rather than waiting for the page's
refresh — `BlockableListing` removes the card — because a refresh under load was seen to arrive and
not be applied (T-176).

## What holds it

- `test/isolation/blocks.spec.ts` — privacy of the row, the blocked set both ways, hidden mission and
  refused quote both ways, unblocking restores, live assignments untouched, the production owner.
- `blocks.service.spec.ts`, `blocks.controller.spec.ts` — naming, follow-through, audit, staff lists.
- Discovery, browse, quote and assignment specs each carry their block case.
- `e2e/blocks.e2e.ts` — both flows in a browser at 375 px and 1280 px.

## Not built

- Reporting a person, profile, mission or assignment to staff — T-173.
- Blocks in messaging (no new conversation; the thread for a live assignment stays) — with messaging, T-174.
- The staff console screens, and staff resolving a flagged assignment — T-175.
