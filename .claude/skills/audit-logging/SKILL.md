---
name: audit-logging
description: The append-only audit event shape, what must be audited, and what must never be logged. Use whenever code mutates state, grants access, serves evidence, or performs a staff action.
---

# Audit logging

The audit log answers "who did what, to what, when, and why" months later, in a dispute,
to someone who was not there.

## Event shape

```ts
{
  id, correlationId,
  actorId,               // or a system actor identifier
  actorRole, staffScope, // scope at the time of the action, not now
  action,                // 'mission.submit', 'evidence.access', 'payout.initiate'
  resourceType, resourceId,
  previousState, newState,   // for transitions
  reason,                    // required for staff and destructive actions
  ipAddress, userAgent,      // where lawful
  occurredAt,
}
```

Record the actor's role and scope **as they were**, not by reference. Roles change; the
audit entry must remain true.

## Must be audited

Authentication events (login, failure, token refresh, session revocation) · every state
transition · evidence and report access, grant, and revocation · media delivery URL
issuance · payments, refunds, payouts, ledger entries · every staff action · account
suspension, deletion, data export · policy decisions on missions · AI tool calls and
confirmations · retention deletions · permission changes.

## Never logged

Passwords, tokens, refresh tokens, session IDs · raw card data · Cloudinary signatures or
signed URLs · evidence content or file bytes · message bodies · full request bodies
containing PII · AI prompts containing evidence.

Log **references**, not content: `evidence_id: 'ev_991'`, never the evidence itself.

## Append-only

The application role has no `UPDATE` or `DELETE` grant on audit tables. Retention is
enforced by a separate privileged process, and that deletion is itself audited elsewhere.

If a correction is needed, append a correcting entry. Never rewrite history — an audit log
that can be edited is not evidence of anything.

## Transaction

The audit entry is written in the **same transaction** as the change it records. Outside
it, you get audited actions that did not happen and real actions with no audit.

## Correlation

One correlation ID flows from the inbound request through services, jobs and webhooks.
Without it, reconstructing a multi-step flow from a dispute is guesswork.

## Audit vs application logs

| | Audit log | Application log |
|---|---|---|
| Purpose | Accountability | Debugging |
| Store | PostgreSQL, append-only | Loki |
| Retention | Policy-driven, long | Short |
| Contains PII | Minimal, deliberate | Never |
| Deletable | Only by policy process | Freely |

Do not conflate them. A debug line is not an audit entry.

## Checklist

- [ ] Written in the same transaction as the change
- [ ] Actor role and scope captured as values
- [ ] Reason present for staff and destructive actions
- [ ] References, not content
- [ ] No secrets, tokens, signed URLs or evidence bytes
- [ ] Correlation ID propagated
- [ ] No update/delete grant for the app role
