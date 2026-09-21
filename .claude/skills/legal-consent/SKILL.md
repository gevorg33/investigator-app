---
name: legal-consent
description: Recording acceptance of legal documents — versioned policies, append-only consent records, content hashing, re-acceptance on change, and the registration gate. Use when implementing registration, terms acceptance, policy updates, or any flow that requires a user to agree to something.
---

# Legal consent

A consent record must answer, years later and to a hostile reader: **which exact text did
this person agree to, in which language, and when?**

A boolean `accepted_terms` column answers none of that and is worth nothing in a dispute.

## Data model

> **Built in T-021** (migration 0015). The shape below is what shipped, with three differences
> worth knowing: the document row holds the **rendered text** as well as its hash, so what
> someone saw can be produced from one row; `content_hash` is computed **by the database** on
> write, so a writer cannot choose one that disagrees with the text; and acceptance and
> withdrawal are one append-only sequence with an `action` column, so "what is true now" is the
> latest row for a person and a document rather than a reconciliation of two tables. A consent
> row also records the workspace it was given in (nullable — registration precedes any
> workspace). The `LegalService` reads the current version and records acceptances;
> `GET /api/v1/legal/documents/:type` serves the text unauthenticated, because registration
> cannot complete without it.
>
> Publishing is **not** an application capability: the app role holds `SELECT` on
> `legal_documents` and nothing else. Versions are put in by the compliance owner
> (ACTIONS-FOR-ME #20).

```
legal_documents                    -- immutable once published
  id, type, version, locale
  content_hash                     -- SHA-256 of the rendered text
  effective_from, published_at
  status                           -- draft | current | superseded
  supersedes_id
  is_authoritative_locale          -- exactly one locale per type+version

user_consents                      -- APPEND-ONLY. Never updated, never deleted.
  id, user_id
  legal_document_id, document_type, document_version
  content_hash                     -- copied at acceptance, not joined
  locale_shown
  accepted_at
  ip_address, user_agent           -- where lawful to record
  context                          -- registration | reacceptance | role_activation
  correlation_id
```

`type` covers: `privacy_policy`, `terms_of_service`, `terms_and_conditions`,
`lawful_use_policy`, and any role-specific agreement.

## Rules

1. **Copy the content hash into the consent row.** Do not rely on a foreign key to the
   document. If the document row is ever corrected, a joined hash changes retroactively and
   the record becomes a lie. The copy is the evidence.

2. **Append-only.** No update, no delete. The application role gets no such grant, exactly
   as with `audit_logs`. Withdrawing consent appends a withdrawal row; it does not remove
   the acceptance that happened.

3. **Published documents are immutable.** A correction — even a typo — is a new version. A
   published document whose text can change makes every consent record referencing it
   unprovable.

4. **Record the locale shown.** On a tri-lingual platform, someone who accepted the Armenian
   text did not accept the English text. Store which one they saw, and designate one locale
   as authoritative per version.

5. **Consent is per document, per version.** Not one flag for "the legal stuff". A user may
   have accepted v3 of the privacy policy and v5 of the terms.

6. **Separate contract acceptance from optional consent.** Agreeing to the terms is
   necessary to use the service. Marketing consent is not, and bundling them makes the
   optional one invalid under GDPR-style regimes. Different rows, different controls, and
   the optional one is independently withdrawable.

## The registration gate

> **Built in T-022.** `legal.requireAcceptance({ userId, types, acceptedDocumentIds, context },
> req, tx)` is the gate, called inside the transaction that creates the account or activates the
> role — so an account that agreed to nothing, or a role whose obligations were never accepted,
> cannot exist. Which documents each context requires is data in `legal.policy.ts`, not a list at
> the call site.
>
> **What is required is what is in force** (owner decision, 2026-09-21). A type with nothing
> published requires nothing: there is no text to agree to, and refusing everybody until counsel
> delivers would be a gate on the wrong thing. The moment a version is published it is required,
> and a material new one makes it outstanding again for those who accepted the old one.
> `GET /api/v1/legal/outstanding` and `POST /api/v1/legal/acceptances` are how a client sees and
> clears that.

Registration cannot complete until the required documents for that role are accepted.

- Enforce **server-side**, in the service. A client-side checkbox is a UX affordance, not a
  gate — assume a hostile client posts straight to the endpoint.
- The account is created and the consent rows are written **in one transaction**. An account
  without consent rows must not be reachable.
- Present the actual text or a link to it. A checkbox next to "I agree to the terms" with no
  retrievable record of what was shown is weak evidence.

## Role activation

A customer who later becomes an investigator accepts the investigator-specific documents at
**role activation**, not at registration — they did not exist as an investigator then.

Gate investigator capabilities on that acceptance the same way registration is gated.

## Re-acceptance on change

When a document publishes a new version:

| Change | Handling |
|---|---|
| Material (rights, liability, data use, fees) | Notify, then require acceptance before continued use. Give notice before `effective_from`. |
| Non-material (typo, clarification, formatting) | Notify; no re-acceptance. Record the version bump. |

> **T-022 note.** Re-acceptance is enforced at the two gates — registration and role activation
> — and surfaced by `GET /legal/outstanding`. It deliberately does **not** block every other
> request: that would block read access to an active assignment's existing obligations, which
> this skill forbids. Gating specific later actions on outstanding acceptance belongs with the
> screens that prompt for it (T-127).

Whether a change is material is a **compliance decision, not an engineering one.** The flag
is set by the compliance owner on the document; code reads it. Do not infer materiality from
a diff.

Users mid-assignment need care: forcing re-acceptance that blocks access to an active
assignment's evidence is its own problem. Allow read access to existing obligations while
gating new actions.

## Audit

Every acceptance, withdrawal and forced re-acceptance emits an audit event
(`audit-logging`). Consent rows and audit entries are separate stores serving separate
purposes — do not collapse them.

## Retention

Consent records outlive the account. Deleting a user does not delete proof that they agreed
to the terms under which their data was processed — that proof is often exactly what a
regulator asks for. This survives account deletion by design, and the retention policy says
so explicitly.

## What this skill does not decide

The **content** of any legal document, whether a change is material, which locale is
authoritative, what lawful basis applies, or which jurisdiction's rules govern.

Those belong to the compliance owner and their counsel. Engineering builds the mechanism and
records the facts faithfully.

## Checklist

- [ ] Content hash copied into the consent row, not joined
- [ ] Consent table append-only; no update/delete grant
- [ ] Published documents immutable; corrections are new versions
- [ ] Locale shown recorded; authoritative locale designated
- [ ] Per-document, per-version rows — not a single flag
- [ ] Contract acceptance separate from optional consent
- [ ] Gate enforced server-side; account and consent in one transaction
- [ ] Role activation gated separately
- [ ] Materiality flag set by compliance, read by code
- [ ] Consent survives account deletion
