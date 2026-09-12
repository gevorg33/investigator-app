---
id: kb-investigator-evidence-upload
title: Uploading evidence — chain of custody and what makes it hold up
audience: investigator
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-12
source_of_truth: docs
implementation_status: specified
related_code:
  - apps/api/src/modules/evidence
  - apps/api/src/modules/media
tags: [evidence, chain-of-custody, uploads, integrity]
---

# Uploading evidence

## What counts as evidence here?

Anything supporting your findings: photographs, video, documents, records, observation
notes. Each item is a record in its own right, with a title, a description, when it was
captured, and how.

Evidence is what gives your report weight. A finding with nothing behind it is an assertion.

## Why can I not edit or delete an item after submitting it?

Because evidence that can be changed after the fact is worth much less, to your customer
and to you.

Each item records who uploaded it, when, and a checksum proving the file has not changed
since. If an item is wrong, submit a correction linked to the original — both are kept, and
the correction states why. That is a stronger position than a silent replacement.

## What should I record about how evidence was captured?

When it was captured, by what method, and any context needed to interpret it. Where it was
captured, if that is lawful and relevant to the finding.

An item that arrives months later in a dispute with no capture context is hard to rely on.
Recording it takes seconds at upload and is the difference between evidence and a file.

## Should I include location data?

Only where it is lawful and necessary for the finding. Location data about identifiable
people is among the most sensitive data you can attach.

If a finding does not depend on precise location, do not attach it. "Observed at the
declared business address" often serves the purpose that exact coordinates would.

## What happens after I upload?

The file is scanned before anyone can open it, so there is a short period where it is not
yet available. Once clear, it becomes part of the assignment.

If a file is rejected by the scan, it does not become available. Re-encoding from the
original source usually resolves a false positive; contact support if it persists.

## Who can see the evidence I upload?

You and the customer on that assignment. Staff can access it only for a specific reason,
such as a dispute, and that access is recorded and visible to the customer.

There are no public links. Each time either of you opens an item, a short-lived authorized
link is issued for that person.

## Can I upload evidence obtained by someone else?

Only if you can state where it came from and are lawfully entitled to hold and share it,
and you must record that provenance on the item.

You are responsible for everything uploaded under your account. Material whose origin you
cannot account for should not be in the assignment.

## What should I not upload?

Anything obtained unlawfully. Anything about people irrelevant to the mission — if a
photograph captures bystanders incidentally, consider whether it is needed. Anything you
could not justify holding if asked.

Evidence is retained under a retention policy and can be examined in a dispute. Upload what
supports the findings, not everything you gathered.

## Does uploading more evidence make my report stronger?

No. Relevant evidence, clearly described and tied to specific findings, is what makes it
strong.

A large volume of unlabelled material transfers the work of interpretation to the customer,
and makes it harder to see what you actually established.
