---
name: evidence-integrity
description: Chain of custody, checksums, access grants, and the FACT/CLAIM/INFERENCE classification for evidence items. Use when implementing evidence upload, storage, access, or review, and when any code or generated text asserts something about an investigation.
---

# Evidence integrity

Evidence may end up in a dispute, an insurance decision, or a court. Build it as if it
will be challenged, because the value of the platform is that it holds up.

## Chain of custody

Every evidence item records: who uploaded it, when it was uploaded, when it was captured
(if known), what device or method produced it (if declared), the media asset reference,
a content checksum, every access event, every review decision, and every modification
attempt.

**Evidence is immutable once submitted.** Corrections are new versions with a stated
reason, linked to what they supersede. There is no edit, and no delete — only a retention
expiry, which is itself audited.

## Checksums

Compute the hash on receipt, store it with the row, and verify it on access. A checksum
computed by the client is a claim about the file, not a property of it — recompute server
side.

If verification fails at access time, refuse to serve, flag the item, and alert. Do not
serve it with a warning.

## Access grants

Participation in an assignment is not access. Access needs an explicit
`evidence_access_grants` row: grantee, evidence item, granted-by, reason, granted-at,
expires-at, revoked-at.

Check the grant, check it is unexpired and unrevoked, then audit the access. Staff access
requires its own grant and is visible in the customer's access log — there is no silent
staff viewing.

## Classification

Every assertion carries a class. This is a database column, not a writing convention.

| Class | Definition | Requires |
|---|---|---|
| `FACT` | Backed by a stored artifact or a verified record | A media asset or a verified source reference |
| `CLAIM` | Asserted by a source, not independently confirmed | Named attribution |
| `INFERENCE` | Reasoned from facts and claims | The reasoning, and what it rests on |
| `HYPOTHESIS` | A working theory | An explicit marker, confined to its own section |
| `UNKNOWN` | No reliable source | Surfaced as an open question |

**Never promote a class silently.** An inference does not become a fact because it is
probably right, or because a later document repeated it.

## Contradictions

When two sources disagree, the system records the conflict — it does not pick a winner or
average them.

```json
{
  "subject": "assignment_88:subject_employer",
  "status": "UNRESOLVED",
  "positions": [
    { "value": "Acme LLC", "source": "evidence_101", "class": "CLAIM" },
    { "value": "Acme Holdings", "source": "evidence_117", "class": "CLAIM" }
  ],
  "recommendedAction": "Obtain an authoritative corporate registry record"
}
```

An unresolved contradiction appears in the report. Resolving one requires a human
investigator's decision, recorded with a reason.

## Confidence

Confidence is a property of an assertion, stored with the assertion, and it always cites
what produced it. A confidence number with no evidence reference is decoration — do not
render it.

## Never

- Mutate a submitted evidence item.
- Let AI-generated text enter an evidence record as `FACT`.
- Serve evidence whose checksum fails, or whose scan is not clean.
- Grant access implicitly from a role.
- Let one user's grant leak into another's session cache.

## Checklist

- [ ] Checksum computed server-side and verified on access
- [ ] Item immutable after submission; corrections are versions
- [ ] Explicit grant required, checked for expiry and revocation
- [ ] Every access audited, staff access visible to the customer
- [ ] Assertion class stored, never silently promoted
- [ ] Contradictions recorded as conflicts, not resolved by guess
