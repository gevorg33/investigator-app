---
name: enforcement-actions
description: Investigator policy violations, due process, suspension and permanent bans — the evidence standard, the review procedure, how a ban survives account deletion without over-retaining data, and what happens to money and live assignments. Use when implementing violations, suspension, bans, appeals, or any account enforcement.
---

# Enforcement actions

A permanent ban ends someone's livelihood on this platform. It must be evidenced, reviewable,
and survivable — meaning it survives the banned party deleting their account, without the
platform hoarding identity documents to achieve that.

## Grounds

Substantiated violation of professional or ethical obligations, including:

- Performing an investigation improperly or negligently
- Deceiving or misleading a client
- Accepting an assignment and abandoning it without valid reason
- Delivering work that fails the agreed scope
- Disclosing confidential client, investigation or assignment information to a competitor or
  any unauthorised third party

Plus the grounds already in the Terms: unlawful work, false licensing information, working
outside licensed scope, off-platform payment, credential sharing, evidence mishandling, abuse.

Not exhaustive. But the list is the starting point of a decision, never its conclusion.

## Evidence standard scales with consequence

| Action | Standard |
|---|---|
| Warning | A credible report |
| Suspension pending review | Reasonable grounds; time-boxed |
| Permanent ban | **Substantiated on the balance of evidence**, from the assignment record |

The record is what decides: the accepted quote, the report, the evidence items, the messages,
the status history, the audit log. A ban that rests only on a customer's assertion, with
nothing in the record supporting it, is not substantiated.

**Negligence and inadequacy are judgements, not facts.** "Completed inadequately" means
measured against the accepted quote's scope — the same test `dispute-handling` applies. An
investigator who reported honestly that something could not be established has performed the
work; that is not inadequacy.

## Due process — required, not optional

1. **Notice** — the investigator is told what is alleged and on what basis, specifically
   enough to answer it.
2. **Right to respond**, with a real window.
3. **Decision by someone uninvolved** in the underlying complaint or dispute.
4. **Written reasoning**, recorded, stating what was relied on.
5. **Appeal** to a different reviewer.

Skipping notice because the case "looks obvious" is how a wrong ban becomes a legal problem.
The only exception is an **immediate precautionary suspension** where leaving the account
active risks customers or their data — and that is a suspension, not a ban, and it still gets
the full process afterwards.

## The conflict you must handle: bans and deletion

We have already committed to in-app account deletion — Apple 5.1.1(v), Play, and the Privacy
Policy — and to deletion removing personal data.

A permanent ban that a user defeats by deleting and re-registering is not a ban.

**Resolution: store a salted hash of the verified identity, not the identity.**

```
verification identity document → salted hash → ban_identity_hashes
```

- The ban record survives account deletion; the identity data does not
- A new registration's verification is hashed and checked against the list
- The hash cannot be reversed into a document number
- Nothing legible about a deleted person is retained

Retain the minimum that makes the ban effective: the hash, the ban date, the decision
reference. **Not** the name, the documents, the case file, or the evidence.

**This needs a lawful basis and belongs in the Privacy Policy** — fraud and safety prevention
under legitimate interests is the usual route, and it is a counsel question, not an engineering
one. See `docs/compliance/counsel-brief.md`.

Never silently retain a full profile and call it a ban record.

## Money

**A ban is not a fine.** Money earned for work already delivered is owed, and withholding it as
punishment is a separate legal problem from the ban itself.

- Completed assignments: payout proceeds
- Disputed assignments: resolved on their own merits first
- A customer refund ordered against the investigator is a claim, and may be set off — that is a
  determination, not a consequence of the ban

Implement the ban and the money as **separate decisions with separate records**. Collapsing
them is how a defensible ban becomes an indefensible one.

## Live assignments

A ban lands on a person who may have work in progress. Customers must not be stranded.

Decide, at the moment of the ban: reassign, complete, or refund each live assignment. Record
which, and why, per assignment. `account-actions` already requires this for suspension; a ban
is the same problem with more finality.

Evidence they uploaded stays with the assignment — it belongs to the case, not the
investigator.

## Records

`investigator_violations`: subject, reporter, grounds, evidence references (**IDs, never
content**), the decision, reasoning, the deciding staff member, the appeal outcome, timestamps.

Append-only. A reversed decision appends a reversal; it never edits the original. An
enforcement history that can be rewritten is worth nothing in a later challenge.

The subject can obtain the decision and its reasoning. Reporter identity may be withheld where
disclosing it creates a retaliation risk — that is a policy decision to record, not an
engineering default.

## Never

- Ban without notice and an opportunity to respond
- Ban on a single unverified report
- Let the deciding reviewer be a party to the underlying dispute
- Withhold earned money as a penalty
- Retain a full identity profile to enforce a ban when a hash suffices
- Edit or delete an enforcement record
- Publish the reason to other users — a removed profile states nothing about why

## Checklist

- [ ] Grounds cited, and evidence referenced from the assignment record
- [ ] Notice given and a response window elapsed, or a precautionary suspension recorded instead
- [ ] Decider uninvolved in the underlying matter
- [ ] Written reasoning recorded; appeal path offered
- [ ] Live assignments each resolved and recorded
- [ ] Money decided separately from the ban
- [ ] Ban persisted as a salted identity hash that survives deletion
- [ ] No identity documents or case content retained beyond the minimum
- [ ] Record append-only and audited
