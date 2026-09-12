# Idempotency

Networks retry. Users double-tap. Providers redeliver webhooks. Any endpoint that creates
something must be safe to call twice.

## Client-supplied keys

Required on: quote acceptance, assignment creation, payment confirmation, payout initiation,
refund issuance. Optional and honoured elsewhere.

```
POST /api/v1/quotes/{id}/accept
Idempotency-Key: 01J8XQ7M2K4N...
```

| Rule | |
|---|---|
| Header | `Idempotency-Key` |
| Format | Client-generated, unique per logical operation. UUID or ULID |
| Scope | Per actor, per endpoint. Two actors may use the same key without collision |
| Lifetime | 24 hours minimum |

## Semantics

1. **First call** — process, store the key with the response and a fingerprint of the request
   body, return the response.
2. **Replay, same body** — return the **stored response**. Do not re-execute.
3. **Replay, different body** — `409` with `IDEMPOTENCY_KEY_REUSED`. A key bound to one
   request must never execute a different one.
4. **Replay while the first is still running** — `409`, retryable. Do not queue behind it and
   do not execute concurrently.

## Enforcement

**A unique constraint, not a read-then-write check.** Read-then-write has a race window, and
under exactly the concurrency it exists to handle, it loses.

```sql
CREATE UNIQUE INDEX idx_idem_key ON idempotency_keys (actor_id, endpoint, key);
```

The key row and the effect commit in the **same transaction**. A key recorded for work that
rolled back blocks a legitimate retry; an effect without its key double-executes.

## Webhooks

Inbound provider webhooks key on the **provider's event ID**, not on a client header. A
duplicate is acknowledged with `200` and dropped — never reprocessed. See
`payments-webhooks`.

Providers also deliver out of order. Idempotency prevents duplicates; it does not prevent
regression. Compare against the state machine, not arrival order.

## Jobs

BullMQ jobs are keyed on a stable business identifier, never a random one. Money-adjacent
jobs put the idempotency check and the effect in one transaction — see `background-jobs`.

## Testing

Every endpoint requiring a key ships with a **concurrent-execution test** proving exactly one
effect. Sequential replay is the easy case; simultaneous is the one that finds the bug.
