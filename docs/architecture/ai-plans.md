# Assistant plans, confirmation and the tool result store

What the assistant may **do**, as opposed to read: a write is proposed, confirmed by its person, and
run by the worker after everything is checked again. Built in T-048 (ADR-0006, ADR-0012). Procedures:
`.claude/skills/ai-tool-registry/SKILL.md` and `.claude/skills/ai-session-context/SKILL.md`. Tools
and their contract: `assistant-tools.md`. Sessions: `ai-sessions.md`. Jobs: `jobs.md`.

```
assistant ── propose ──► ai_plans + ai_plan_steps (PROPOSED, hashed)      the model is the caller
person    ── confirm ──► CONFIRMED once, + ai.plan.confirmed (outbox)     an authenticated request
worker    ── execute ──► re-check → each step re-authorized and run      as the person, in their workspace
```

**No write tool exists yet.** `WRITE_TOOLS` (`modules/ai/plans/write-tools.ts`) is empty: this is the
gate the first commands (T-095) will pass through, and the confirmation UI is T-058. Until then no
plan can be proposed in production; the machinery is tested with a write tool of the specs' own.

## Tables

| | |
|---|---|
| `ai_plans` | session, owner (copied from the session), `plan_hash`, `status`, `confirmation_status`, `expires_at`, `confirmed_at`, `confirmed_role`, `reason` (a code), `finished_at` |
| `ai_plan_steps` | plan, session and owner (copied from the plan), `ordinal` (1–10), `tool`, `arguments`, `observed` (a digest), progress: `status`, `result`, `error` (a code), `started_at`, `finished_at` |
| `ai_tool_results` | session, owner, `tool`, `summary`, `items`, `total` |

All three are **private as their session**: row-level security admits only the session's own user,
in its own workspace — not an agency's owner, not the same person in another workspace. Each is
erased with its session (`SESSION_CONTENT`). Migration 0042.

## Proposing — `AiPlansService.propose` (no route)

Each step goes through `ToolRunner.prepare`: the tool registered and a **write**, the account ACTIVE,
in a workspace, one of the tool's roles as held now, the tool's rate limit, arguments parsed strictly
— and then the tool's `observe`, which reads what the step would act on. **Nothing runs.** The plan
stores the arguments **as parsed** (what will run is what the person sees) and a digest of each
observation. One to ten steps; an unknown tool, or arguments the tool does not take, refuse the plan
(422) and store nothing. Audited `ai_plan.proposed` with the tools' names — never their arguments —
and each tool's `ai.tool.*` row reads `proposed: …`.

**The hash** (`plan-hash.ts`) is SHA-256 over canonical JSON — keys sorted at every depth — of the
plan's id, its session and every step's ordinal, tool, arguments and observation digest. Change any
of them and it is a different plan.

**A proposal waits 24 hours** (`PLAN_TTL_MS`), then reads `EXPIRED` and cannot be confirmed: what it
was about may have moved on. Expiry is derived from `expires_at`, never stored.

## Routes — `/api/v1/ai/sessions/:sessionId/plans`

| | |
|---|---|
| `GET …/plans` | The session's plans, newest first, at most 20. `?open=true`: only those not yet ended — proposals awaiting an answer, and confirmed plans until they finish, so a stuck one stays in view (T-224). What a returning client shows, after a closed browser or a restarted app |
| `GET …/plans/:planId` | One plan, its steps and their progress |
| `GET …/plans/:planId/timeline` | The plan from proposal to its last step, with its audit (T-214) — below |
| `POST …/plans/:planId/confirm` `{ planHash }` | The person's yes, to exactly the plan with that hash |
| `POST …/plans/:planId/decline` | The person's no, to a plan still awaiting one |

Another person's session or plan — a stranger, a colleague, the agency's owner, or the caller's own
in another workspace — is the 404 an unknown id gets. `ai-plans.authz.spec.ts` tries every path.

## Confirming — once, for exactly what was shown

The model proposes and **never confirms**: confirming is the person's authenticated request, and no
tool reaches it. In one transaction, with the plan row locked:

1. still `PROPOSED` — otherwise 409 `NOT_PENDING` (`error.validation.ai_plan.not_pending`): a
   confirmation is used once, and a second yes or a no after a yes changes nothing;
2. not expired — otherwise 409 `EXPIRED`;
3. the client's `planHash` is the plan's — otherwise 409 `CHANGED`;
4. the stored steps still hash to it — otherwise the plan is `CANCELLED` / `INVALIDATED`
   (`hash_mismatch`) for good, audited, and 409 `CHANGED`. A trigger already refuses any rewrite of a
   step; this catches a writer that went around it.

Then `CONFIRMED`, with the time and the role the person had narrowed to (`confirmed_role`), and an
`ai.plan.confirmed` outbox event — both or neither. Audited `ai_plan.confirmed`; a decline,
`ai_plan.declined`.

**Retrying a confirm** after it succeeded answers 409 `NOT_PENDING`; the plan, read again, says
`CONFIRMED`. The plan's state is its own idempotency record, so the route takes no
`Idempotency-Key`.

## Running — `PlanExecutor`, in the worker

`PlanConfirmedTrigger` hears `ai.plan.confirmed` in the producer's context — the person who
confirmed — and queues `ai.plan.execute`, keyed `ai-plan-<id>`, on the `events` queue. The confirming
request's correlation id rides on the event and the job, so the confirmation, the plan's end and every
step's audit row share it (T-212); a job queued before that runs under its own id. The job
runner re-reads that person's account, membership and workspace (a removed member's job is refused,
`context_refused`) and runs `ExecutePlanHandler` in their context:

```
plan locked in the job's transaction (lock_timeout 5s) → still CONFIRMED — otherwise nothing to do
  → if no step has started: confirmed within the last 15 minutes else: confirmation_stale
  → steps still hash to plan_hash                         else: hash_mismatch
  → the person read now (ActorService.forJob)            else: account_refused
  → in the role they confirmed as, if they narrowed       else: role_revoked — never wider
  → every step's tool registered in the worker            else: tool_unavailable
  → if no step has started: every step observed again
      as the person, the same digest as proposed          else: state_changed / recheck_<code>
  → EXECUTING; each step in order: RUNNING → re-authorized and run (ToolRunner.runConfirmed:
      account, workspace, role, strict arguments — no rate limit, the person decided this)
      with idempotency key ai-plan:<plan>:<ordinal> → DONE with the tool's output projection
  → COMPLETED                                             audited ai_plan.completed
```

**Refused before any step ran**, the plan is `CANCELLED` and its confirmation `INVALIDATED`: nothing
happened, and the person needs a fresh proposal to confirm. **Refused after**, or a step refused
(an `AppError` — its code lower-cased into the step's `error`), the plan is `FAILED` (`step_failed`
or the reason above), the remaining steps `SKIPPED`: some of it happened, and the steps say which.
Audited `ai_plan.invalidated` / `ai_plan.failed` with the reason code. Each step's tool call is also
its own `ai.tool.*` row, `ok: confirmed: …`.

**A killed worker is replaced by one that resumes, and never repeats.** The plan's status commits
with the job's claim; each step's progress is written **outside** that transaction, as it happens.
A worker that dies loses the transaction — the plan reads `CONFIRMED` again, the claim is gone, and
BullMQ delivers the job again — but not the steps. A `DONE` step is not run again. A step left
`RUNNING` is run again with the same idempotency key, which every write tool must honour (ADR-0012):
the tool may have taken effect before the worker died. So whether a plan has started is read from its
steps, which survive, never from its status. A started plan is not observed again: its own first
steps may have moved the state it acts on, and that is not a change the person did not see. Two
deliveries at once are one run: the second waits on the claim and is a duplicate.

**Every plan ends (T-224).**
- **Execution deadline.** A confirmed plan the worker has not started 15 minutes after confirmation
  (`EXECUTION_DEADLINE_MS`) is invalidated as `confirmation_stale`, and the person confirms again: what
  they confirmed may have moved on. A started plan finishes whenever its worker returns.
- **A job that fails for good.** It is dead-lettered after five attempts, or at once when its context
  is refused. Its handler's `onDeadLetter` then ends the plan, in the audited system context: nothing
  ran → `CANCELLED` / `INVALIDATED`; something ran → `FAILED`. Either way the reason is
  `infrastructure_failed`. PENDING steps become SKIPPED; a step left RUNNING stays RUNNING — it may have
  taken effect. A later replay (T-168) finds nothing to run.
- **Lock timeout.** The run waits at most 5 seconds for its plan row; past that the job is retried. A
  cycle through the run's own step writes, on another connection, is one PostgreSQL cannot see.

The person is told how it ended — below.

**No edges.** Steps run in order and do not depend on each other. Dependencies — a step that consumes
another's output — are T-096's DAG, over these same rows.

## Telling the person how it ended (T-226)

Confirming returns at `CONFIRMED`; the worker runs the plan later. So the conversation is told.

**One `PLAN_OUTCOME` message per ended plan, written by the database.** `record_ai_plan_outcome`
(migration 0045) fires `AFTER UPDATE OF status` on `ai_plans` when the status becomes `COMPLETED`,
`FAILED` or `CANCELLED`. In the transaction that ends the plan, it appends a `SYSTEM` message of kind
`PLAN_OUTCOME` to the plan's session. It takes the session's next sequence under the session row's lock,
as `AiSessionsService.append` does, and leaves the session's activity and archive state alone. A trigger,
because the plan has several writers: the worker, the dead-letter hook, a person's decline, a confirm
that finds the rows rewritten, and the departing-member function, which is SQL. Whoever ends the plan,
the conversation says so. The status moves forward only and ends once (`check_ai_plan_change`), so there
is exactly one message. A worker that dies before its commit takes the message with the status, and the
run that does end the plan writes it.

The message has no words (`content` is null). Its `event` is built from the step rows:

```json
{ "planId": "…", "outcome": "partial", "status": "FAILED", "confirmation": "CONFIRMED",
  "reason": "step_failed",
  "steps": [ { "ordinal": 1, "tool": "createTeam", "status": "DONE",    "error": null },
             { "ordinal": 2, "tool": "inviteMember", "status": "FAILED", "error": "forbidden" },
             { "ordinal": 3, "tool": "inviteMember", "status": "SKIPPED", "error": null } ] }
```

| `outcome` | When |
|---|---|
| `completed` | `COMPLETED`, **and** every step `DONE` |
| `partial` | Otherwise, any step `DONE` — or left `RUNNING`, which may have taken effect |
| `failed` | `FAILED`, and nothing took effect |
| `declined` | The person said no |
| `not_run` | Voided or invalidated before anything ran |

**The outcome is read from the steps, never from the status alone.** A plan that stopped part-way is
never told as done, even if something wrote `COMPLETED` over an unfinished step. A step still `PENDING`
when its plan ends will never run, so it is told as `SKIPPED`. 0043 ends a departing member's plan
first and skips its steps afterwards; the outcome reads the same either way. `ai_messages_shape` holds
the event to this shape: role `SYSTEM`, no content, a `planId`, one of the five outcomes, and a `steps`
array.

**The reader's catalog writes the words.** app-web renders the event (`assistant/plan-outcome.tsx`) from
`assistant.outcome.*` in en, ru and hy:
- the outcome, and a sentence for a reason worth one (`confirmation_stale`, `hash_mismatch`,
  `state_changed`, any `recheck_*`, `account_refused`, `role_revoked`, `tool_unavailable`,
  `member_left`, `infrastructure_failed`);
- for a plan that attempted anything, each step: done, failed with its code, not run, or "started, and
  may have taken effect".

A partial plan says that what was done stays done: undo is never automatic, and an inverse is offered as
a new plan (T-096). No model writes any of it. The Context Builder (T-046) reads the same event.

**A notification when it is not what was asked.** When `PlanExecutor` ends a plan short of what was
asked, it writes `ai.plan.ended` (`payload: { to }`) to the outbox in the same transaction. That is
`FAILED`, or `CANCELLED` before anything ran, and it covers the dead-letter path too. The person
confirmed and walked away, and may not be watching. The notification fan-out re-reads the plan's row and
tells its own person `assistant_plan_failed` or `assistant_plan_voided`, in the centre only
(`notifications.md`); opening one opens the assistant on that conversation (T-231). A completed plan
is what they asked for, and a decline is their own; neither notifies. A departed member is not notified, because they are no longer a member.

**The client polls while a plan runs.** The API needs nothing more for that: `GET …/plans/:planId` and
`GET …/plans?open=true` read the status and step rows as they stand. app-web's confirmation UI (T-058,
`app-web.md`) reads a running plan every 2 seconds until it ends, then reads the conversation's
PLAN_OUTCOME message. It reads nothing while the tab is hidden, and once at once when it shows again
(T-235).

## The timeline (T-214)

`GET …/plans/:planId/timeline` returns the plan from proposal to its last step, for its own person,
admitted exactly as `get` is. Built by `buildTimeline` (`plan-timeline.ts`):

```json
{ "planId": "…", "sessionId": "…", "status": "FAILED", "outcome": "partial",
  "correlationId": "<the confirming request's id>", "unknown": [2],
  "events": [ { "type": "proposed", "steps": 3 }, { "type": "confirmed", "role": null },
              { "type": "step_started", "ordinal": 1, "tool": "createTeam" },
              { "type": "step_finished", "ordinal": 1, "tool": "createTeam", "status": "DONE", "error": null },
              { "type": "step_started", "ordinal": 2, "tool": "inviteMember" },
              { "type": "ended", "status": "FAILED", "confirmation": "CONFIRMED", "reason": "infrastructure_failed" } ],
  "audit":  [ { "action": "ai_plan.proposed", "outcome": "createTeam,inviteMember,inviteMember", "correlationId": "…" },
              { "action": "ai.tool.create_team", "outcome": "ok", "correlationId": "…" } ] }
```

(Every entry also has an `at`.)

- **`events` come from the plan's own rows, in causal order:** proposed, confirmed, then each step by
  ordinal, started then finished, then ended. They are not sorted by clock. The database stamps a
  plan's creation, and the API and the worker stamp its progress. Their clocks need not agree; in
  development the database ran 50–250 ms ahead, which put "ended" before "proposed".
- **A step's status is its row's.** A FAILED step shows FAILED with its code. A step left RUNNING when
  the plan ended has no finish, and is listed in `unknown`: it may have taken effect.
- **`outcome` is the plan's `PLAN_OUTCOME` message** (0045), so the timeline and the conversation never
  disagree. It is null while the plan is open.
- **`audit` is in the database's own time order**, and holds two kinds of row:
  - the plan's lifecycle (`ai_plan.proposed`, `confirmed`, `declined`, `invalidated`, `failed`,
    `completed`), by its person;
  - the tool calls their confirmation made, joined by its correlation id (`correlationId`, T-212).

  Each entry carries a code only: the plan row's reason, or the tool call's first word (`ok`,
  `rejected`). Never arguments, an address, a device, or anyone else's row. A colleague's refused look
  at the plan is audited in the same workspace and is left out. A dead-lettered run's end is audited
  in the system context, which belongs to no workspace, so that row is absent; the plan's own
  `ended` still says how it ended.

Staff reading a person's plan timeline is not built. It reads a private conversation's content under
`PlatformContext`, so it needs its own approval (T-234).

## When a member leaves the workspace

`archive_departed_member_sessions` (migration 0028, extended in 0042 and corrected in 0043, T-224)
archives the person's sessions in that workspace, and ends their open plans there, whoever made the
change:
- **Not started** (no step left PENDING): `CANCELLED` / `VOIDED`, `member_left`.
- **Started** — a step ran, and the plan still reads `CONFIRMED` because a worker died part-way:
  `FAILED`, `member_left`, by way of `EXECUTING`. Its never-run steps become SKIPPED, and a RUNNING step
  stays RUNNING. 0042 voided these too, which reported a half-run plan as never run.

Either way, the archived conversation gets the plan's `PLAN_OUTCOME` message (T-226) and stays
archived.

A plan running at that moment holds its row; the departure waits for the run to end and then leaves
it as it ended. `rls.spec.ts` holds the function to exactly these statements.

## Deleting the conversation (T-224)

`AiSessionsService.delete` settles the session's plans before it erases them:
- **Running** — its row held by the worker (taken with SKIP LOCKED, so never waited for), or started
  and waiting for a retry: the delete is refused, `409 PLAN_IN_FLIGHT`
  (`error.validation.ai_session.plan_in_flight`). Erasing it would wait on the worker and take the only
  record of what ran.
- **Confirmed, not started:** audited `ai_plan.voided`, `session_deleted`; its job finds nothing.
- **Ran:** audited `ai_plan.erased` with its status and the commands done, failed, running or skipped
  — command names only, never arguments.

## Kept by the database

- **A plan is fixed once proposed** (`check_ai_plan_change`): nothing the hash covers changes; status
  only moves forward (`PROPOSED → CONFIRMED | CANCELLED`, `CONFIRMED → EXECUTING | CANCELLED`,
  `EXECUTING → COMPLETED | FAILED | CANCELLED`); `CONFIRMED` is reached only from `PENDING` and left
  only for `INVALIDATED` or `VOIDED`; a confirmation keeps its time.
- **A step is fixed once proposed** (`check_ai_plan_step_change`): only its progress is written, and a
  finished step stays as it finished.
- **Status and confirmation move together** (`ai_plans_status_pairs`): nothing runs unconfirmed.
- **Owners copied and never changed**; a plan's owner is its session's, and a step's its plan's
  (composite foreign keys). Nothing is added to a deleted session.
- **Every ended plan tells its conversation once** (`record_ai_plan_outcome`, 0045), whoever ended it
  — above.

## Write tools

A write tool registers only with `confirmation: 'required'` — lowering it is approval-gated
(AGENTS.md) — and `observe(actor, input, req)`, which returns the state a confirmation is checked
against: the status and version of what it acts on, read as the caller. `execute` receives a
`ToolEffect` with the step's idempotency key and must be idempotent on it. `ToolRunner.invoke` refuses
a write — it runs only as a confirmed step. Every write tool is in `WRITE_TOOLS`, registered by both
the API and the worker (`ai-plans.wiring.spec.ts`); the services it calls must therefore be available
in the worker too.

## The tool result store — `ToolResultStore`

```
tool → keep: the whole result, in the session → result_id + summary + first 20 + cursor
     → page(result_id, cursor): the next 20, sliced in PostgreSQL
```

A search returning 10,000 records contributes a summary and twenty of them; the model asks for the
next page. The cursor carries its result's id and is refused for any other (422). `forContext(ref)`
is the only way a stored result is rendered for a model — at most `RESULT_PAGE` records, whatever it
is handed — and a spec holds that nothing but the store reads the table. Results are written once
(`ai_tool_result_fixed`) and erased with the session.

Nothing stores a result yet: the first caller is the conversational orchestrator (T-095), which also
records tool calls and results in the session as `TOOL_CALL` / `TOOL_RESULT` messages referencing
`resultId` — and decides which arguments may be kept there (a location shared for a search is stored
nowhere, `ai-sessions.md`). The Context Builder (T-046) renders results through `forContext`.

## What holds it

- `ai-plans.service.spec.ts` — proposal fixed, hashed, observed and not run; refusals store nothing;
  confirm once, for the hash shown, event in the same transaction; wrong hash, expiry, a rewritten
  step; decline; survives a restarted API (a new process finds and confirms it); a departing member's
  plans voided and nobody else's; erased with the session; the trigger's envelope.
- `ai-plans.executor.spec.ts` — through the real job runner: runs as the person, each step once with
  its key; two deliveries one run; state changed, hash broken, role revoked, confirmed role gone,
  account suspended — nothing runs; a refused step fails the plan; a worker killed before or after a
  step's effect is replaced and the plan completes with each effect once.
- `ai-plans.outcome.spec.ts` — one outcome message per ended plan, from every writer: completed,
  partial with the failed step's code, failed, invalidated, left running, declined, rewritten at
  confirm, a departing member's (started and not); a worker killed after the last step's effect, and
  after the status write before its commit, still gives exactly one; through direct writes, no mix of
  steps makes a FAILED plan `completed`; the shape constraint; `ai.plan.ended` only for endings to tell; an outcome is its person's alone —
  a colleague in the same workspace reads none of it.
- `ai-plans.timeline.spec.ts` — completed, partial with the FAILED step's code, a step left running
  (`unknown`), still proposed, declined; codes only in the audit; a colleague in the same workspace
  gets 404 and their audited refusal is not in the person's timeline.
- `ai-plans.authz.spec.ts` — a stranger, a colleague and the agency's owner get 404 on every path,
  the timeline included; the policy shows them nothing; a confirmation does not cross the person's own
  workspaces.
- `ai-plans.hash.spec.ts`, `ai-plans.controller.spec.ts`, `ai-plans.wiring.spec.ts`,
  `ai-results.store.spec.ts`, `ai-discovery.registry.spec.ts` (the runner's write paths).
- The isolation matrix covers all three tables.
