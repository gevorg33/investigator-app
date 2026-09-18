---
id: kb-investigator-verification
title: Verification — documents, review, and keeping it current
audience: investigator
visibility: authenticated
locale: en
version: 2
status: current
updated: 2026-09-18
source_of_truth: docs
implementation_status: specified
related_code:
  - apps/api/src/modules/verification
  - apps/api/src/modules/media
tags: [verification, documents, licensing, compliance]
---

# Verification

## Why do I need to be verified?

Because customers are handing private matters to a stranger. Verification is what makes
that reasonable, and it is the main thing the platform offers them that a directory listing
does not.

Unverified investigators do not appear in customer results and cannot submit quotes.

## What documents do I need to provide?

Proof of identity, and proof of your professional standing where your jurisdiction requires
it — a licence, a registration, or an equivalent. Some categories of work require
additional evidence of qualification.

The exact set depends on where you work and what you do. A list of required documents per
jurisdiction and specialty is specified but not yet built, so the platform does not currently
tell you which documents your declared areas and specialties need. A reviewer checks what you
submit against what you declared, and a rejection says what was missing.

You can attach up to ten documents to one application.

## Who can see my verification documents?

You, and staff whose role is reviewing verification — nobody else. Staff can open them only
while acting in that role.

Every time anyone opens one, you included, it is recorded: who, which document, and when.

Customers never see your verification documents. They see that you are verified, not the
documents behind it. Your documents are stored as private files with no public link, the
same protection applied to evidence. A link to open one is created on request and stops
working after five minutes, so a link that is copied or forwarded is quickly useless.

## Which files can I upload?

PDF, JPEG or PNG, up to 15 MB each. A photo from a phone or a scan of a licence both fit.

The upload is checked after it arrives, against the file itself rather than what the browser
said about it. A file that is not really one of those types, or is larger than the limit, is
removed and you are asked to upload again.

## Why can't I open a document I just uploaded?

Each file is checked for malware before anyone can open it, including you. Until that check
reports the file as clean, it cannot be opened by anyone. This keeps a harmful file from
reaching the staff who review it.

## How do I apply for verification?

Upload your documents, then submit an application with them. The application records the
specialties and service areas on your profile at the moment you submit, and that is what a
reviewer checks your documents against. Set up your profile before you apply.

You can have one application open at a time. While it is open your status shows as pending,
unless you were already verified, in which case you stay verified.

## How long does review take?

Review is carried out by staff rather than automatically, so it is not instant. Decision
notifications are not built yet; you can see each application's status and the reason for
its decision in your verification history.

Submitting complete, legible documents that match the areas and specialties you declared is
the single biggest factor in how quickly it resolves. Mismatches between what you declared
and what your documents show are the usual cause of delay.

## Why was my verification rejected?

The decision states its reason. Common ones: a document that is expired, illegible, or
does not cover the jurisdiction you declared; a licence that does not extend to a specialty
you listed; or a mismatch between your identity document and your profile name.

Rejection is not permanent. Correct what the reason identifies and submit a new
application. Your earlier application and its decision stay in your history.

A decision covers the whole application. If your documents support only some of what you
declared, the application is rejected with a reason that says which parts; remove the
unsupported specialties or areas from your profile, or add documents that cover them, and
apply again.

## What happens when my licence is due to expire?

Document expiry is not yet tracked by the platform. Expiry reminders, and the automatic lapse
of verified status when a required document expires, are specified but not built.

When they are, a lapsed required document will lapse your verified status with it: you will
stop appearing in discovery and be unable to quote until it is restored, while assignments
already in progress continue. Until then, submit a new application with the renewed document
before the old one expires.

## Can I change my specialties or service areas after being verified?

Yes. Removing a specialty or area takes effect immediately.

Verification currently applies to your profile as a whole rather than to each specialty or
area. Review of individual additions is specified but not built. To have additions checked,
submit a new application with documents that cover them; you stay verified while it is
reviewed, and a rejected addition does not remove your existing verification.

## Does being verified mean the platform vouches for my work?

No. Verification confirms that your identity and professional standing were checked against
documents you provided. It is not a warranty of quality, and it does not transfer your
professional liability to the platform.

Your rating and completed work are what speak to quality.
