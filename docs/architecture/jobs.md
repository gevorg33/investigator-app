# Background jobs and the outbox (T-082)

Background work runs **as the workspace that asked for it**, with that workspace's authority read
again when it runs — never carried in the job. Row-level security applies to a worker exactly as it
does to a request (tenancy.md §7, §9).

```
request (in context) ──► outbox row: event + producer's tenant, user, membership (by DEFAULT)
                              │
worker process                ▼
  OutboxDispatcher ── system context, once ──► reads unpublished rows (SKIP LOCKED)
                                               enqueue outbox.deliver job, mark published
  BullMQ (Redis) ──► JobWorkers ──► JobRunner
                                     re-read account, membership, workspace ── gone? ─► dead letter
                                     runInContext(restored) → BEGIN
                                       claim key in job_runs  ── taken? ─► duplicate, nothing done
                                       handler (subscribers) with the transaction
                                     COMMIT
```

## The envelope

`{ jobId, key, command, tenantId, userId, membershipId, payload }` (`common/jobs/job.ts`):

- **Ids, never permissions.** A job queued by a member who is removed, a workspace since suspended, or
  an account since suspended or deleted is refused (`context_refused`); the permissions a job runs
  with are the membership's on the day it runs.
- All three ids, or none: a job with none is a **system job** and runs in the audited system context
  (`jobs.run_system`), in no workspace.
- `key` is what the job is idempotent on, **within its workspace** — not within its command. Two
  jobs in the same workspace with the same key are one job: the second is a duplicate and does
  nothing. A job queued *from* another job needs a key of its own (T-036: a fan-out queued by
  `outbox.deliver` is keyed `<event>-fan-out`, not `<event>`). `jobId` is BullMQ's id — stable for
  the same work, so enqueueing it twice is one job while Redis still knows the first.
- Producers build one with `envelopeFor(command, key, payload)`, which takes the ids from the
  current context and never from an argument. `systemEnvelope` makes a system job, and
  `envelopeAs` a job for a named member — only the system context uses it, to hand work to the
  person it concerns (T-036), and the runner re-reads that membership as it does any other.

## Running a job — `JobRunner`

1. The envelope is checked (what comes out of Redis is data, not a type), the command found, the
   payload parsed by its handler — any failure here is permanent.
2. The context is re-read by `WorkspaceResolver.forJob` and restored with `runInContext`. A job has
   no session: its audit rows record none.
3. One transaction: insert the key into `job_runs` (`ON CONFLICT DO NOTHING`); if it was already
   there the job is a duplicate and nothing runs; otherwise the handler runs **in that transaction**.
   The effect and the record that it happened commit together, so a retry after a failure does the
   work, and a retry after success does nothing. The claim is the unique constraint's
   (`(tenant_id, job_key)`, NULLS NOT DISTINCT so system jobs dedupe too), never a read-then-write.

## Delivery, retries, dead letters — `common/jobs/job-queue.ts`

- Five attempts, exponential backoff from 2 s with 50 % jitter; completed and failed jobs are
  trimmed from Redis — what matters is in PostgreSQL.
- A `PermanentJobError` (refused context, unknown command, bad payload), or the last attempt of any
  other failure, is written to `job_dead_letters` — the envelope's context, payload, our description
  of the error and the attempts — and BullMQ is told to stop (`UnrecoverableError`).
- Dead letters are written and read only in the system context.
- Workers route their `error` events to the process log; an emitter without an `error` listener
  would bring the process down on a Redis blip.

## The outbox

`outbox_events` is written by services in the same transaction as the change it records
(`background-jobs`). Since T-082 each row carries its producer — `tenant_id`, `user_id`,
`membership_id` — filled from the context by DEFAULT. Its policies (migration 0032):

| | Who | Rule |
|---|---|---|
| INSERT | the producer | all three ids are the context's own — not even another member of the same workspace — or the system context |
| SELECT, UPDATE | the dispatcher | the system context only; a producer cannot read its own events back (so no `INSERT … RETURNING`) |

`OutboxDispatcher.run` enters the system context **once for the worker's lifetime** (one
`platform.access` audit row, not one a second), takes up to 100 unpublished events with
`FOR UPDATE SKIP LOCKED`, enqueues an `outbox.deliver` job for each in its producer's context, and
marks them published in the same transaction. If that transaction fails, the events are handed off
again, and the key makes the repeat a duplicate. An event the system produced (a payment becoming an
assignment) has no producer, and its delivery runs as a system job.

### Acting on an event

`OutboxDeliveryHandler` hands the event to every `EventSubscriber` for its type, with the job's
transaction. A task that needs one writes a class with `eventType` and `handle(event, tx)` and adds
it to `EVENT_SUBSCRIBERS` in `worker.ts`. It runs in the producer's workspace and reaches the
database only through `tx`. The first are the notification triggers (T-036, `notifications.md`):
they only queue a job on the `notifications` queue, because who else an event concerns is not
something the producer's context can read. `PlanConfirmedTrigger` (T-048) queues a confirmed plan's
`ai.plan.execute` job as the person who confirmed it (`ai-plans.md`).

### Adding a job type

A `JobHandler` (`command`, `queue`, `parse`, `run(payload, tx, envelope)`) in `JOB_HANDLERS`. Its
file ends `.handler.ts`, and `jobs.static.spec.ts` holds that it never injects the database.

**One deliberate exception to "the effect commits with the claim"**: a confirmed plan
(`ExecutePlanHandler`, T-048) runs steps whose tools call services with their own transactions, so
the effects cannot share the job's. The plan's status commits with the claim; each step's progress is
written by `PlanExecutor` as it happens, so a worker that dies is replaced by one that resumes from
the steps rather than repeating them, and a step caught mid-way is run again under the same
idempotency key (`ai-plans.md`).

## Redis is a trust boundary

The runner re-checks that a job's user, membership and workspace belong together and are still
active — it cannot tell who put the job on the queue. Anyone able to write to Redis could queue work
as any valid member, or as the system. So Redis is internal only: never reachable from the internet
(T-023), reached by the API and the worker alone, and with a password wherever it is not on a
private network. Nothing about a job is trusted beyond that: its payload is parsed by its handler,
and every read and write it makes goes through row-level security in the restored context.

## The worker process

`pnpm --filter api worker` (`dist/worker.main.js`) — validates the environment as the API does,
starts one worker per queue a handler uses, and runs the dispatcher until SIGTERM or SIGINT; then
lets jobs in progress finish and disconnects. It connects to PostgreSQL as the runtime role
(`DATABASE_URL`) and refuses to start as any role row-level security would not apply to.

| Setting | |
|---|---|
| `REDIS_URL` | The queues' Redis (already required by the API) |
| `JOB_QUEUE_PREFIX` | Key prefix, default `investigator`. Environments sharing a Redis must differ |

Locally, with the compose stack up:

```bash
pnpm --filter api build
cd apps/api && NODE_ENV=development DATABASE_URL=postgres://investigator_app:investigator_app@localhost:5433/investigator_dev \
  REDIS_URL=redis://localhost:6380 SESSION_SECRET=$(openssl rand -hex 32) node dist/worker.main.js
```

On a server it is the `worker` service in `infrastructure/compose/server.yml` (T-208): the API's
image running the package's `worker` script, the API's environment file, and the same
topology-decided environment as the API (`x-api-environment` — the hosts, Redis, `TRUSTED_PROXIES`,
which the shared schema requires in staging and production). No port; `internal` for PostgreSQL and
Redis, `egress` for the mail provider. It starts once both are healthy, and has 30 seconds after
SIGTERM to let jobs in progress finish. Its queues use the default prefix: each environment's stack
has its own Redis. `apps/api/test/edge.spec.ts` holds this wiring. Since T-204 retention runs here
too, so an environment without the worker deletes nothing on schedule.

## Scheduled jobs (T-204)

`JobQueue.schedule(queue, id, everyMs, envelope)` installs a BullMQ job scheduler; installing the same
id again replaces it, and the schedule lives in Redis, so every worker may install it and each
interval still queues one job. `unscheduleExcept(queue, prefix, keep)` removes an owner's schedulers
that the code no longer has. A scheduler queues the same envelope every time, so the worker keys each
run by the queue's id for it (`scheduledRun`: `repeat:<id>:<time>`) — otherwise the first run's claim
in `job_runs` would make every later run a duplicate. The first user is retention, on the
`maintenance` queue: `RetentionSchedule` installs a scheduler per rule when the worker starts, and
`RetentionSweepHandler` runs one (`docs/compliance/retention.md`, "How retention runs").

## What holds it

- `jobs.runner.spec.ts` — context restored with today's permissions; removed member, suspended
  workspace, suspended or deleted account refused; forged membership or workspace refused; duplicates
  and system duplicates; a failed run leaves no claim.
- `outbox.dispatcher.spec.ts` — producer columns from the context; forging refused; the producer
  cannot read its events; hand-off, rollback, the long-running loop audited once; end to end through
  Redis, a subscriber runs once in the producer's workspace.
- `jobs.queue.spec.ts` — delivery, dedupe by job id, dead letters with context, retries to the last
  attempt, worker errors reported.
- `jobs.static.spec.ts` — every `this.db` under `common/jobs` inside `runInContext`/`asSystem` and
  awaited there; handlers never hold the database.
- The isolation matrix covers `outbox_events`, `job_runs` and `job_dead_letters`.
- `retention-sweep.spec.ts` — a sweep through the real runner, one crossing and its report; a
  redelivered run a duplicate, the next run its own; schedules installed, a retired rule's removed,
  another owner's left; through Redis, each scheduled run keyed by itself. `worker.spec.ts` — the
  worker installs the schedule on start and says what it removed.

## Not built

- Replaying dead letters, and alerting on their count — T-168.
- Pruning `job_runs`, dead letters and published outbox rows — a rule each in `retention-rules.ts`
  once their periods stop being provisional (`retention.md`).
