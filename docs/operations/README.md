# Operations handbook

**This directory is never ingested into the knowledge base.** Nothing here is retrievable
by the AI Assistant, for any audience, including staff.

That is deliberate and it is defence in depth. Retrieval-layer visibility enforcement
(`permission-aware-rag`) is the primary control, but it is code, and a single mis-set
frontmatter field would be the only thing standing between this content and a user asking
the right question. Content whose disclosure would help someone game the platform does not
belong in a retrievable store at all.

## What belongs here

- Fraud and abuse detection heuristics, indicators, and thresholds
- Escalation criteria and the escalation path
- Law-enforcement request handling and the legal escalation path
- Document-fraud indicators used in verification review
- Pattern-detection thresholds across disputes, accounts and payments
- Incident response runbooks
- Alert runbooks — one per alert

## What does not belong here

Procedure and policy explanation that staff need day to day and that a leak would embarrass
but not weaponise. That goes in `docs/knowledge-base/staff/` with `visibility: staff`, so
the Assistant can help staff with it.

The test: **would knowing this let someone evade the control it describes?** If yes, it
belongs here. If it would merely reveal how we work, it belongs in the knowledge base.

## Cross-references

The staff knowledge-base articles deliberately stop short and point here — see
`verification-review` on suspected document fraud, `mission-policy-review` on escalation,
`dispute-handling` on pattern handling, and `evidence-access` on law-enforcement requests.
Keep that boundary when editing either side.

## Contents

Runbooks are added as the alerts and procedures they describe are built. See
`infra-devops`: an alert with no runbook is noise, so the runbook lands with the alert.
