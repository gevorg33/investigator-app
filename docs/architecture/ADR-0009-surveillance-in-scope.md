---
adr: 0009
title: Surveillance is in scope; web-first, mobile deferred
status: Accepted
date: 2026-09-13
supersedes: —
superseded_by: —
related:
  - docs/architecture/ADR-0004-web-first-workspace.md
  - docs/architecture/ADR-0008-source-capability-axis.md
  - docs/knowledge-base/policies/prohibited-requests.en.md
  - docs/product/taxonomy-draft.md
---

# ADR-0009 — Surveillance in scope, mobile deferred

**Status:** Accepted · **Date:** 2026-09-13

## Context

The platform was briefly narrowed to public and authorised information only, with surveillance
excluded entirely. That narrowing lived in the policy documents; it was never an ADR.

It has been reversed by product decision. The trade was made explicitly: surveillance is the
larger market and the substantial part of real private-investigation revenue, and the mobile
app is the price.

## Decision

**The platform supports lawful investigation, including surveillance and observation, subject
to a stated lawful basis and to the investigator being licensed where licensing applies.**

Scope returns to "lawful, with basis stated and screened" rather than "public and authorised
sources only".

Partner and relationship investigation — loyalty checks — is **in scope**, with the controls in
the section below.

**The mobile companion app is deferred, not cancelled.** Its artifacts, skills and tasks are
retained and marked blocked.

## What this costs, recorded plainly

These are consequences of the decision, not arguments against it. They are written down so the
next person does not rediscover them.

1. **Google Play.** Play's Stalkerware and Monitoring policy permits monitoring apps only for
   parental and enterprise use, and prohibits tracking a partner **even with consent**. A
   companion app for a marketplace that sells partner investigation cannot credibly claim to
   perform no monitoring. Mobile is therefore deferred. Apple is less categorical but not
   clear.
2. **Payment processing.** Most major processors restrict surveillance-related services in
   their acceptable-use policies. `plan.md` §12 already lists the provider as unresolved; this
   decision makes provider acceptance a **launch-blocking question**, not a later detail.
3. **Licensing becomes a hard gate.** Many jurisdictions license surveillance specifically and
   more strictly than records research. Verification must establish that an investigator is
   licensed for surveillance in the jurisdiction where the work will happen — not merely
   licensed.
4. **Third-party data exposure rises substantially.** Covertly gathered material about
   non-users is the most sensitive data the platform will hold. Counsel brief §3 and questions
   8–11 become more pressing, not less.
5. **Screening returns to the harder question.** "Is this public or authorised information?"
   was answerable by a moderator. "Is this surveillance lawful here, for this subject, by this
   method, given this person's standing?" is not, reliably. Moderation load and moderator
   training both increase.

## Partner and relationship investigation — the controls

This category is offered deliberately, not by omission. The following are the conditions under
which it is offered, and they are not optional extras:

- **Jurisdiction gate.** Available only where the work is lawful. The platform does not offer it
  everywhere it has users.
- **Standing declared.** The customer states their relationship to the subject and their
  purpose. "I want to know" is recorded as the basis, and the moderator sees it as such.
- **Mandatory moderation every time**, regardless of queue configuration or risk band.
- **Investigator must be licensed for surveillance** in the jurisdiction of the work.
- **The prohibitions remain**, and are not softened by this category: no tracking devices, no
  access to accounts, devices or communications, no interception, no ongoing monitoring
  arrangements, nothing unlawful in the jurisdiction concerned.
- **Observation only, bounded.** A mission has a defined scope and duration. Open-ended
  monitoring is not a product.

The abuse concern is real and does not disappear because the category is offered: partner
surveillance is a documented precursor to domestic abuse. The controls above are what make
offering it defensible, and weakening them later should be treated as reopening this decision.

## What survives from the narrowed period

- **The source capability axis (ADR-0008)** stands. It remains useful for records-based work,
  and gains a field-capability dimension for surveillance.
- **Data minimisation and relevance** requirements stay. Missions must contain only what the
  work requires.
- **Evidence provenance** — investigators record the source and method for each item — stays,
  and matters more now, not less.
- **The prohibited list** stays: unlawful access, stolen material, harassment, impersonation.

## Consequences

**Accepted:** no mobile app for the foreseeable future · payment provider acceptance becomes a
launch blocker · licensing verification becomes stricter and jurisdiction-specific · higher
moderation load · materially greater third-party data exposure.

**Gained:** the addressable market most PI revenue actually sits in · a product customers
recognise · investigators whose practice is surveillance-led become a fit.

## Revisit when

- A payment provider declines, which would force the question again on commercial grounds
- A jurisdiction the platform operates in changes its position on partner investigation
- Mobile becomes strategically necessary, which would require re-narrowing scope or accepting
  web-only distribution permanently
