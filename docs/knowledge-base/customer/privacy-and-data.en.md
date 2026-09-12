---
id: kb-customer-privacy-data
title: Your privacy — who can see what, and what happens to your data
audience: customer
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-12
source_of_truth: docs
implementation_status: specified
related_code:
  - apps/api/src/modules/users
  - apps/api/src/modules/evidence
  - apps/api/src/modules/audit
tags: [privacy, data, deletion, export, retention, security]
---

# Privacy and your data

## Who can see my mission?

Before submission, only you. Drafts are private and appear in no search.

After submission, investigators who are eligible to quote on it can see the mission
details. They cannot see your contact details at that stage. Once you accept a quote, that
one investigator sees what the assignment requires them to see; the others no longer have
access.

## Who can see my evidence and reports?

You and your assigned investigator. Nobody else by default — including staff.

Staff access requires a specific reason, usually a dispute you raised, and it requires an
explicit grant. Every access is recorded and is visible to you. There is no administrative
mode that browses customer evidence.

## Can other customers see anything about me?

No. There is no customer-facing directory of customers, and missions are not public.
Reviews you leave are attributed to a customer of that assignment, not to a public profile
with your mission history attached.

## Is the subject of my investigation told about it?

Not by the platform. The platform does not notify anyone that they are the subject of a
mission.

Your legal obligations are a separate matter. Some jurisdictions and some kinds of work
carry notification or consent requirements, and an investigator licensed there will tell
you if that applies. The platform does not give legal advice on this.

## What data does the platform hold about me?

Your account details, your missions and their history, quotes, assignments, payments,
messages, evidence and reports, and an audit record of significant actions taken on your
account.

The audit record exists so that a dispute can be resolved on the basis of what actually
happened, rather than on recollection.

## Can I get a copy of my data?

Yes. A data export produces what the platform holds about you.

Exports are generated as a background job rather than instantly, and you are notified when
yours is ready. This is because assembling it safely requires checking what you are
entitled to receive.

## Can I delete my account?

Yes. Deletion removes your account and your personal data, subject to what the platform is
legally required to retain.

Some records survive deletion because the law requires it — financial records for tax
purposes are the usual example. Evidence within a completed assignment may also be retained
under its own retention rule, since the investigator is a party to it too. The retention
policy sets out what applies.

## How long is my data kept?

It depends on the type. Missions, evidence, reports, verification documents and financial
records each have their own retention period, set out in the retention policy.

Data is not kept indefinitely by default. If you need something beyond its retention
period, download it first.

## Is my data encrypted?

Yes, in transit and at rest. Evidence and other private files are stored as private
resources with no public URL, and are served only through short-lived authorized links
issued after a permission check.

## What should I do if I think my account has been accessed by someone else?

Change your password immediately, review your active sessions in settings and revoke any
you do not recognise, then contact support.

Do not wait to be sure. Revoking a session you do recognise costs you a re-login; leaving a
session you do not recognise costs considerably more.
