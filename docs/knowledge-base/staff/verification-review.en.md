---
id: kb-staff-verification-review
title: Reviewing investigator verification
audience: staff
visibility: staff
locale: en
version: 3
status: current
updated: 2026-09-24
source_of_truth: docs
implementation_status: specified
related_code:
  - apps/api/src/modules/verification
tags: [staff, verification, review, queue]
---

# Verification review

## What am I deciding in a verification review?

Whether the documents submitted establish the applicant's identity and professional standing
for the specialties and service areas they declared.

You are not assessing whether they are a good investigator. You are checking that they are
who they say they are and are permitted to do what they say they do.

## What do I check?

Identity documents against the profile name. Professional documents against the declared
jurisdictions. Expiry dates. Whether the declared specialties fall inside what the
documents actually cover.

The mismatch between declaration and document is the finding that matters most, and it is
the one most easily missed by reading the documents alone without re-reading what was
declared.

## What reason do I give for a rejection?

A specific one the applicant can act on. "Documents insufficient" tells them nothing and
produces a resubmission with the same problem.

"The licence provided covers jurisdiction X, but service areas were declared in X and Y" is
actionable. The reason is stored and shown to the applicant, so write it for them.

## Do I need a reason to approve an application?

Yes. Every verification decision, approval or rejection, requires a reason. For an approval,
say what you checked — "Licence number confirmed against the national registry" — because an
approval nobody can later explain is not a review. The reason for an approval is shown to the
applicant as well, so write it for them too.

## What was the applicant's declaration when they applied?

Each application records the specialties and service areas the applicant had declared at the
moment they submitted it, and that record does not change while you review. Check the
documents against that recorded declaration, not against the live profile, which the applicant
may have edited since.

## Can I approve part of what was declared?

Not yet. A verification decision currently covers the whole application: you approve
everything the applicant declared, or you reject the application. There is no partial
approval, because verification is not yet tracked per specialty or per service area.

If the documents support only part of what was declared, reject the application and say
exactly which parts the documents support and which they do not. The applicant can then
remove the unsupported specialties or areas from their profile, or supply documents that cover
them, and apply again. Do not approve an application whose documents cover only part of the
declaration.

## What if documents look altered?

Do not approve, and do not reject with a reason that describes what you noticed. Escalate.

The operational procedure for suspected document fraud is in the internal operations
handbook, not here.

## Am I allowed to keep copies of verification documents?

No. Review them in the platform. Do not download, screenshot, forward, or store them
anywhere else.

Your access is recorded. These are identity documents belonging to a real person, and they
are held under a retention rule that only applies while they stay inside the platform.

## What happens when a document is about to expire?

Document expiry is not yet tracked by the platform. Expiry notifications and the automatic
lapse of verified status when a required document expires are specified but not built.

Until they are, check expiry dates yourself as part of every review. A document that has
already expired is a reason to reject the application, stated as such.

An investigator working with a lapsed licence is a compliance matter to escalate, not
something to resolve by re-approving.

## Someone I know has applied. What do I do?

Leave it for another reviewer. Do not review an application where you have a personal or
commercial relationship with the applicant. There is no assignment of applications to
reviewers yet, so leaving it means not opening it and telling your lead.

The platform refuses only one case on its own: you cannot decide your own application, even
if you hold the verification scope.

Your decision is attributed to you permanently and is visible in any later dispute or audit.

## Can a decision be changed after it is made?

No. An application is decided once, and the decision and its reason are kept permanently. If
the applicant corrects the problem, they submit a new application, and both decisions stay in
the history you see when reviewing.
