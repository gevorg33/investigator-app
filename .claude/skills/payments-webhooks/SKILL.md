---
name: payments-webhooks
description: Payment intent creation, webhook signature verification, idempotency, the append-only ledger, fees, payouts, refunds and reconciliation. Use for any work in the payments or payouts modules, or when handling a provider webhook.
---

# Payments & webhooks

All work here is HIGH risk and approval-gated. A money bug is not fixed by a redeploy.

## Truth comes from webhooks

An assignment becomes paid because a **verified webhook** said so. Never because a client
callback said so, never because a redirect returned, never because the client sent a
status field.

```
Client → create intent (backend) → client confirms with provider
Provider → webhook → verify signature → check idempotency → map to our state
        → ledger entry + state transition + audit (one transaction)
```

## Webhook handler rules

1. **Verify the signature before parsing the body.** Use the raw body — a body parser that
   re-serializes breaks verification.
2. **Reject stale timestamps.** A replayed old event is an attack.
3. **Idempotency by provider event ID.** Store processed IDs; a duplicate is acknowledged
   and dropped, not reprocessed. Providers retry, and they deliver out of order.
4. **Handle out-of-order events.** Do not regress state because a `succeeded` arrived
   after a `processing`. Compare against the state machine, not the arrival order.
5. **Acknowledge fast, process reliably.** Persist the event, return 200, process in a
   BullMQ job. A slow handler causes retries, which causes duplicates.
6. **Map events explicitly** — including the ones you ignore. An unhandled event type is
   logged and alerted, never silently dropped.

## Ledger

Append-only, double-entry-shaped. Every movement is an entry; corrections are compensating
entries. Never update or delete a ledger row.

Each entry: amount in **integer minor units**, currency, direction, account (platform fee,
investigator payable, customer paid, refund), the assignment, the provider reference, the
idempotency key, the timestamp.

The ledger reconciles to the provider's balance. A reconciliation job compares periodically
and **alerts on drift** — it does not auto-correct.

## Money

Integer minor units and an explicit currency, everywhere — database, API, client. No
floats, no decimals-as-strings arithmetic.

Rounding rules for fee splits are written down, tested with adversarial values (1 minor
unit, amounts that do not divide evenly), and the remainder's destination is a decision,
not a `Math.round` side effect.

## Idempotency

Quote acceptance, assignment creation, payment confirmation, payout initiation and refund
issuance all take a stable idempotency key and are safe to call twice concurrently.
Enforce with a unique constraint, not with a read-then-write check.

## Required tests

- Signature verification rejects a tampered body and a wrong signature
- Replay of the same event ID produces exactly one state change and one ledger entry
- Out-of-order delivery does not regress state
- Concurrent quote acceptance creates exactly one assignment
- Fee split totals equal the charge, for adversarial amounts
- Refund produces compensating entries, not edits
- Reconciliation detects an injected drift

## Never

- Store raw card data, anywhere, including logs and error reports.
- Use live keys outside production.
- Trust an amount, currency or status from the client.
- Change fee, split or refund policy without explicit human approval.
- Move money without a ledger entry and an audit event in the same transaction.

## Before starting

Confirm with a human that the provider is actually available for the target countries with
the required licensing, tax handling and payout support. plan.md flags this as unresolved.
