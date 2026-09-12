---
name: background-jobs
description: BullMQ queues, the transactional outbox pattern, idempotent job design, retries, dead-letter handling and scheduled work. Use when adding a queue, a worker, an async side effect, or any code that emits a domain event.
---

# Background jobs & events

## The outbox pattern

Never publish an event from inside a database transaction, and never publish after it. The
first can publish an event for a transaction that rolls back; the second can lose the
event if the process dies.

```
1. In one transaction: write the domain change AND an outbox row.
2. A relay worker reads unprocessed outbox rows and publishes them.
3. Mark processed.
4. Retry with exponential backoff.
5. Permanent failures go to the dead-letter queue and alert.
```

This gives at-least-once delivery, which is why every consumer must be idempotent.

## Idempotency

Every job may run twice. Design for it:

- Key the job on a stable business identifier, not a random ID.
- Check-and-write atomically — a unique constraint, not a read-then-write.
- Make the effect naturally idempotent where possible (set a value rather than increment).
- For external calls, pass an idempotency key the provider honours.

A job that sends an email twice is embarrassing. A job that issues a payout twice is a
company-ending bug. Treat them differently: for money-adjacent work, the idempotency check
and the effect share a transaction.

## Queues

Email · push · media processing · Cloudinary validation · malware scanning · report
generation · embedding generation · knowledge reindexing · payment reconciliation · payout
reconciliation · verification reminders · mission expiration · retention cleanup ·
analytics aggregation.

Separate queues by latency class and blast radius. A slow reindex must not delay a
notification. A poisoned media job must not stall payments.

## Retries

- Exponential backoff with jitter. Synchronized retries create thundering herds.
- Cap attempts, then dead-letter. Infinite retry hides failure.
- Distinguish retryable (timeout, 503, lock contention) from permanent (validation error,
  404, rejected by policy). Retrying a permanent failure wastes capacity and delays the
  alert.

## Dead letters

A DLQ that nobody reads is a silent failure. Alert on depth, keep the original payload and
the error, and make replay a one-command operation after the fix.

## Scheduled work

Mission expiry, quote expiry, verification reminders, reconciliation, retention deletion.
Each is idempotent, bounded (`LIMIT` per run), and logs what it acted on. A retention job
that deletes data is audited like any other destructive action.

## Workers and secrets

Workers run with their own scoped credentials. A media worker does not need payment
credentials. Never give a worker broader database grants than it uses.

## Checklist

- [ ] Domain change and outbox row share one transaction
- [ ] Consumer is idempotent, enforced by a constraint
- [ ] Retryable and permanent failures distinguished
- [ ] Backoff has jitter, attempts capped
- [ ] DLQ alerts and can be replayed
- [ ] Scheduled jobs bounded and idempotent
- [ ] Queue separation reflects blast radius
- [ ] Money-adjacent jobs: idempotency check and effect in one transaction
