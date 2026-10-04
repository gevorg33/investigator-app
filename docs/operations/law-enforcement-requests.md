# Law enforcement and regulator requests

<!-- not-for-ingestion -->

**Not ingested into the knowledge base.**

The staff knowledge base says: do not provide anything, do not confirm what exists, route it
here. This is that route.

## If you receive a request

**Do not:**

- Provide any data, in any form, including verbally
- **Confirm or deny that an account, mission or assignment exists.** Confirming existence is
  itself a disclosure
- Tell the requester what you can or cannot see
- Search for the subject to find out what we hold
- Discuss it outside the escalation route

**Do:**

1. Record who made contact, how, when, and what they asked for
2. Ask for the request in writing, if it is not already
3. Route it to the legal escalation owner **the same day**
4. Stop

Being unhelpful in the moment is correct here. An informal disclosure can compromise a legal
process and the platform's position at once, and it cannot be undone.

## Why confirming existence matters

"We have no account for that person" and "I can't discuss that" are different answers, and the
first is a disclosure. Use the second, always, regardless of whether an account exists.

## What a valid request needs

Assessed by the legal escalation owner, never by the person who received it:

- Correct legal instrument for the jurisdiction
- Correct entity named
- Scope that matches the authority relied on
- Whether we may notify the affected user, must not, or must

## Notification

Some jurisdictions require notifying the user; some prohibit it; some are silent. Never decide
this at the point of contact.

## Preservation

A preservation request is not a disclosure request. It may require placing a **legal hold**
(T-035) without producing anything.

Holds block retention deletion. Apply one only on instruction from the legal escalation owner,
and record it.

**How (T-035, T-205).** A staff member holding the `COMPLIANCE` scope places the hold in the staff
console under **Legal holds** (or through `POST /api/v1/legal-holds`) — `resourceType` (`USER`, `TENANT`, `MISSION`, `ASSIGNMENT` or
`MEDIA_ASSET`), `resourceId`, and a `reason` naming the request (its reference, the authority, the
instruction), at least a sentence. Hold every record the request covers: the account, and each
mission, assignment or file it names — a hold covers the resource it names and the rows that
belong to it, not everything connected to it.

- The reason is visible to `COMPLIANCE` staff only, never to the account holder. The audit trail
  records that a hold was placed on what, by whom — not the reason.
- **Holds on one record** on that page (or `GET /api/v1/legal-holds?resourceType=USER&resourceId=…`)
  shows what is held on an account.
- When the preservation period ends, choose **Release** on the hold's card (or
  `POST /api/v1/legal-holds/{id}/release`) with a reason saying who confirmed it may end. A release
  cannot be undone; place a new hold if needed.

## Emergency requests

Some jurisdictions permit expedited disclosure where there is a risk to life. These are real
and they are also a known social-engineering vector — a forged emergency request is a
well-documented attack on platforms.

Escalate. Urgency asserted by the requester is not authority, and an emergency route that
bypasses verification is the vulnerability.

## To be completed by the platform owner

- [ ] **Legal escalation owner** — named role and contact
- [ ] **Out-of-hours contact**
- [ ] **Counsel** for each launch jurisdiction
- [ ] Whether a **transparency report** will be published
- [ ] Verification procedure for emergency requests
- [ ] Retention period for records of requests received
