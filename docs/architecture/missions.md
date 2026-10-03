# Missions, the state machine, and policy screening

How a mission is created, submitted, screened and moved. Built in T-010. The lifecycle in
product terms is `docs/product/mission-lifecycle.md`; the procedure is
`.claude/skills/mission-state-machine/SKILL.md`. This document describes the implementation.

## The shape of it

```
customer writes a draft ──submit──► SUBMITTED ──screening──► UNDER_REVIEW ──► a moderator (T-051)
```

A draft is private to its customer and can be saved incomplete. Submission is the only thing
that makes a mission visible to anyone else, and it never makes it visible to investigators:
publication is a moderator's decision, always.

Incomplete is not incoherent. Every save (`POST /missions/me`, `PATCH /missions/me/:id`) is
refused with `422 VALIDATION_FAILED`, naming each field, when the draft as it would be stored has
a budget minimum above its maximum (`budgetMaxMinor`, `error.validation.budget.range`), a start
after its deadline (`deadline`, `error.validation.deadline.range`), or a title, description,
purpose or place sent as an empty string (that field, `error.validation.mission.blank` — send
`null` to clear one). A request that moves one end of a range is judged against the stored other
end. The CHECK constraints `missions_budget_range`, `missions_timeline_order` and
`missions_text_lengths` stay as the last line; before T-153 they were the only one, and each of
these reached the client as a 500.

## One writer for the status column

`MissionTransitionService.apply` is the only code that writes `missions.status`, and
`mission-status-writes.spec.ts` fails the build if anything else does. In the caller's
transaction it:

1. checks the move against the transition map
2. checks the performer's authority for *that* move — a staff member must hold the named scope
3. writes the status, plus any column that changes with it
4. appends a `mission_status_history` row
5. appends the audit entry, through `AuditService` **with the transaction**
6. appends the `outbox_events` row

All six commit together. A status written outside this path has no history and no audit trail,
which is exactly the state that makes a dispute unresolvable.

### The map is data

`mission-transitions.ts` holds every legal move as a table of
`from → to → who may do it`. The test matrix is generated from it: 17 statuses × 17
destinations × 9 authorities, with every triple the map does not list asserted refused. The
illegal cases are the test — they are the ones nobody remembers to write by hand.

Two properties are asserted about the map as a whole rather than about single edges:

- **QUOTED is reachable only from UNDER_REVIEW, and only by `STAFF:MODERATION`.** Any future
  edit that adds another path to publication fails this test.
- **The system can never publish or reject**, from any status, whatever screening found.

### Concurrency

Two guards, because one is not enough:

- Callers read the mission `FOR UPDATE`, so a second transition waits and then sees the first
  one's result rather than a stale status.
- The UPDATE additionally matches on the version **and** status that were read. A caller that
  skipped the lock changes nothing and gets a `STATE_CONFLICT`.

Tested with two simultaneous submissions and with a simultaneous submit and cancel: exactly one
succeeds, and the loser leaves nothing behind — no second screening row, no second history row.

Customers' own writes carry the version they last read, so two browser tabs cannot silently
overwrite each other either.

### When a mission was published

`published_at` is not written by the transition service: the trigger `missions_published_at` sets
it on every entry into QUOTED and refuses any other write to it (T-054). It is what investigator
browse orders "newest" by (`discovery.md`).

## Screening: deterministic, and never a decision

`mission-policy/` screens every submission inside the submitting transaction. It answers one
question: **how urgently should a person look at this?**

| Outcome | Meaning |
|---|---|
| `ROUTINE_REVIEW` | Nothing tripped. Still reviewed — a clean screen is not an approval |
| `PRIORITY_REVIEW` | A rule matched, the band is high or restricted, or the category is unbanded |

There is no third outcome. Screening cannot publish and cannot reject, and the transition map
makes that structural rather than a matter of discipline.

### The ruleset

`mission-policy.rules.ts` is a versioned list of phrase rules over the mission's own text,
covering the categories in the Lawful Use Policy: account and device access, covert monitoring
software, tracking devices, interception, protected records, impersonation, open-ended
monitoring, harassment, and unlawful entry. Plus three structured rules, from answers rather
than prose: partner investigation, a declared protective order, and an unbanded category.

- **Deterministic**: the same text and the same `ruleset_version` always produce the same
  flags. A screening result can be explained months later from the stored version alone.
  Change a rule, bump the version.
- **Flags raise the band and the queue position. They decide nothing.** A false positive costs
  a moderator a minute; a false negative still reaches a person. That asymmetry is what makes a
  phrase list acceptable here at all.
- Text is normalised first — NFKC, case, zero-width characters, curly apostrophes, ё/е — but
  the rules do not pretend to defeat deliberate evasion, and a test says so.
- English and Russian today. **Armenian is not covered** (T-067): an Armenian mission is still
  reviewed, it is just not prioritised by its text.

### An unbanded category is treated as HIGH

Risk bands live on taxonomy nodes, and T-053 bands the tree after domain review. Until then
most nodes have no band, and a missing band is **not** evidence that work is low risk — so it
screens as `HIGH` and carries a `category_unbanded` flag.

### AI may classify, never decide

`screenMission` takes `ScreeningInput` and nothing else. There is nowhere to put a model's
opinion, so no later edit can quietly feed one into a policy decision without changing the
signature. A classification, when one exists, is stored beside the result in
`mission_screenings.ai_classification` as labelled input for the moderator.

Tested as behaviour: the same mission screened with an alarming classification, a reassuring
one, and none at all produces three identical results — and a classification naming a real rule
id does not set that flag.

Nothing produces classifications yet; the AI gateway is Phase 7. When it does, it runs **before**
the transaction opens — a model call is not something to hold a row lock through.

## What the customer is told

The mission they get back carries no screening data: no flags, no outcome, no band. The staff
article is explicit that a customer is told the policy position, never the detection — so the
projection simply has no such fields, and a test asserts the serialised response contains
neither a flag id nor an outcome.

**What a moderator decided** is on the mission as `review` (T-119): `{ outcome: 'REJECTED' |
'CHANGES_REQUESTED', reason, decidedAt }`, or `null`. It is read from `mission_status_history` —
the mission's **latest** move only, and only when it is a STAFF move out of `UNDER_REVIEW` to
`REJECTED` or `DRAFT`. So it disappears once the customer resubmits or cancels, stays while a
returned draft is edited (an edit is not a move), and can never be screening's own move into
review, whose reason (`PRIORITY_REVIEW:HIGH`) is SYSTEM-written and internal. `GET /missions/me`,
`GET /missions/me/:id` and `PATCH` return it; creating, submitting and cancelling are themselves the
latest move, so they return `null`.

**The reason a moderator writes on a rejection or a return is shown to the customer as written.**
T-051 must present that field as customer-facing, and keep any internal note elsewhere.

## The lawful-purpose confirmation

Required before submission, recorded with its timestamp, and **cleared when a mission returns
to DRAFT** so that a resubmission is confirmed afresh. It is written in the same UPDATE as the
transition, never before it: a draft whose submission failed must not be left looking confirmed.

Enforced in three places, deliberately: the DTO (`true` and nothing else), the service, and a
CHECK constraint that refuses any non-draft mission missing the confirmation or any required
field — whatever wrote it.

## Tables

| Table | Grant | Why |
|---|---|---|
| `missions` | S/I/U | No DELETE: a mission carries history, and later quotes and money |
| `mission_status_history` | S/I | Append-only. A history that can be edited settles no dispute |
| `mission_screenings` | S/I | Append-only. A result that can be rewritten explains nothing |
| `outbox_events` | S/I/U | The relay marks rows published; no DELETE, pruning is a retention job |

**Order is `seq`, not `occurred_at`.** `occurred_at` is its transaction's start time, so the moves
one transaction writes share it, and a wall-clock step can put a later move before an earlier one.
The latest move — what `reviewsOf` reads to tell a customer about a rejection or a request for
changes — is the highest `seq`, an identity assigned at insert (migration 0025, T-155).

> **A GRANT alone decides nothing here.** Migration 0000 sets `ALTER DEFAULT PRIVILEGES`
> granting SELECT, INSERT, UPDATE and DELETE on every table created in this schema, so a new
> table arrives fully writable and a narrower GRANT adds nothing. Withholding a privilege means
> REVOKING it. Migration 0007 shipped its GRANTs without the REVOKEs and the two append-only
> tables were fully writable; `grants.spec.ts` now proves the privileges on all four.

## The outbox

Every transition appends a `mission.status_changed` event carrying references — mission id,
from, to, version — and never content. Rows accumulate unpublished until the relay exists
(T-036, with BullMQ); that loses nothing, because the event is written with the change rather
than derived from it afterwards.

## Privacy

- A mission's **location is coarsened to two decimal places** — about a kilometre — exactly as
  a service-area centre is. A mission's location is often where its subject lives.
- Free-text reasons (a customer's cancellation reason) go to `mission_status_history`, never
  into the audit log, which keeps references rather than content.
- Drafts are invisible to everyone but their owner, and a mission belonging to someone else
  answers 404 rather than 403 — a 403 confirms the id is real.
- **The customer is masked until hire (T-100).** Every investigator-facing view names the customer
  only by `customerAlias` — four Crockford base-32 characters of `sha256("customer-alias:" +
  missionId)` (`modules/missions/customer-alias.ts`). It is built from the mission alone, so two
  missions of one customer have unrelated aliases. No first name: none is collected, and a
  free-text `display_name` can lead with the surname (owner decision 2026-10-01). The name itself
  reaches an investigator only through `GET /profiles/customer/:id` once they are hired
  (`profiles.md`). **Held by `test/identity-masking.spec.ts`**, which walks every GET route and
  every POST under `/search` as an investigator who has quoted on the customer's mission — each
  path parameter filled with every id they could hold — and fails if any successful answer carries
  the customer's surname, email, phone or user id. A new route is walked the day it exists; a new
  kind of resource an investigator can hold (a conversation) also needs its id added to the
  spec's `ids`, or its view is walked with nothing in it.

## Moderation: the publication gate (T-051)

Every mission under review waits for a moderator in the staff console (`admin-web.md`). Nothing else
publishes: the transition map lets only `STAFF:MODERATION` move a mission into QUOTED, only the
transition service writes the status, and `MissionModerationService` is the only caller that asks
it for a staff move — `mission-moderation.invariant.spec.ts` holds all three.

- **Routes** (`/moderation/missions`, MODERATION staff scope, acting as staff): the queue, one
  mission, and `POST …/:id/decision` with `{ outcome, reason, internalNote?, tagIds?, version }`. Each enters
  `PlatformContext` with its own `RoutePurpose` (`mission_moderation.queue|review|decide`), audited
  as a crossing before it runs.
- **The queue** orders by the latest screening's risk band (RESTRICTED first), then by when the
  mission last entered UNDER_REVIEW, keyset-paged. A draft nobody submitted is not found.
- **Three outcomes:** `PUBLISHED` → QUOTED, `REJECTED` → REJECTED, `CHANGES_REQUESTED` → DRAFT, which
  also clears the lawful-purpose confirmation so the next submission is confirmed afresh. A reason is
  required for all three; the console keeps the control disabled until one is typed.
- **What the customer reads** is the reason, as written, on the history row the transition writes
  (`review`, above). The **internal note** lives only in `mission_moderation_decisions`, which
  staff alone can read (row-level security: platform access only) — the customer's workspace cannot
  see the table at all.
- **Refused:** the mission's own customer (403, audited — under review nobody has quoted, and
  agencies are supplier-only in v1, so the customer is the only party); a mission that moved since it
  was read — another moderator decided, or the customer cancelled — is 409, and two moderators
  deciding at once leave exactly one decision.
- **The record** (`mission_moderation_decisions`, append-only): outcome, reason, note, moderator,
  the mission version and the screening they read, the category and band at the time, and
  `queued_at` → `decided_at`. That is review latency per category and band from the first day, the
  data any later opening of the gate rests on.
- **Review latency** (T-193): `GET /moderation/missions/latency?days=30|90|365` (90 by default)
  reads the record back per category and risk band — decisions, median, 90th-percentile and longest
  wait, and how many were published, returned and rejected. Aggregates only: no mission, customer or
  moderator is named. It enters `PlatformContext` as `mission_moderation.latency`. It is what T-191
  would be decided on, and it opens nothing.
- **Tags** (T-055): the review view carries the mission's tags, each marked suggested and/or
  confirmed. A PUBLISHED decision may carry `tagIds` — the ACTIVE tags the mission is published
  with, which become *confirmed* (`confirmed_at`, `confirmed_by`) in the same transaction. Any other
  outcome with `tagIds` is 422 `error.validation.moderation.tags_on_publish`; an unknown or retired
  tag is 422 and the mission stays under review. A suggestion left out stays a suggestion, which
  nobody but the customer and staff ever reads. The customer's own view carries both sets —
  `tagIds` (suggested) and `confirmedTagIds` (published with, merges followed, T-194) — read under the `reads` policy
  of `mission_tags`, which already admits the customer's own tenant. Tags never touch screening or eligibility
  (`taxonomy.md`, "Tags").
- **AI classification** is shown in the console as labelled input. Nothing in the view suggests an
  outcome, and the decision names one every time.
- **Attachments** do not exist yet; opening them, audited per access, is T-066's.

## What T-010 deliberately did not build

- **Mission attachments** (T-066). Screening reads text and structured answers only, and the
  staff article's instruction to open the attachments has nothing to open yet.
- **Per-category gate configuration.** The gate is closed: every mission is reviewed (plan §10).
  T-051 records review latency per category and band instead; the switch that could ever open it
  is T-191, gated on that data and on counsel.
