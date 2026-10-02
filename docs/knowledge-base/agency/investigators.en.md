---
id: kb-agency-investigators
title: Your agency's investigator profiles
audience: agency
visibility: authenticated
locale: en
version: 2
status: current
updated: 2026-10-02
source_of_truth: database
implementation_status: partial
related_code:
  - apps/api/src/modules/profiles
  - apps/app-web/src/components/agency/console
  - apps/api/src/modules/service-areas
  - apps/api/src/modules/search
  - apps/api/src/database/migrations/0037_add_agency_investigator_profiles.sql
tags: [agency, investigators, profiles, discovery, quoting, members]
---

# Your agency's investigator profiles

> This article explains how agency profiles work. Which profiles your agency runs, and what is on
> them, live in your agency's data and are read live.

## How does my agency get investigator profiles?

An owner or admin makes a profile for a member of the agency, and that member holds it. An agency can
run as many profiles as it has investigators, but only one for each person.

The member must be active in the agency and must already have taken up the investigator role
themself, from their own Personal workspace. That is where an investigator accepts the investigator
terms, and an agency cannot accept them on someone's behalf. A member who has not done this yet is
asked to do it first.

A new agency profile starts as every profile does: hidden from customers, not verified, and not
accepting work.

## Is an agency profile the same as the investigator's own profile?

No. An investigator can have their own profile in their Personal workspace, for work they do
independently, and a separate profile in each agency they work for. Each has its own headline, prices,
areas, verification and listing, and neither stands in for the other. When the investigator works in
your agency's workspace, the profile they see and quote with is the agency's one.

## Where do I manage our investigator profiles?

Working in your agency, open **Account** and choose **Investigators**. Each profile shows who holds it
and where it stands for customers — shown or hidden, verified or not, taking work or not — and says
when its holder is suspended or has left. On a phone each profile is a card; on a wide screen, a row.

**Make a profile** offers the members who are active and have none here yet. **Edit** opens a profile's
own page, with the same sections an investigator sees on their own profile — what customers read,
languages, specialties, hours and areas — except the holder's legal name and their choice of name, which
are theirs. Each section saves on its own, and the page shows the change at once. When the holder is
suspended or has left, the page says so at the top, and the profile cannot be shown again until they
are reactivated.

## Who in my agency can see and change our investigator profiles?

Every member can see the agency's investigator profiles. Owners and admins can make new ones and
change them.

## What can the agency change on an investigator's profile?

What customers see of the profile: the headline and description, the pseudonym the investigator is
shown by, experience, how they charge and their usual rate, a contact phone for the platform's staff,
languages, specialties, availability, service areas, and whether the profile is shown to customers
and accepting work.

The agency cannot change the investigator's legal name, which belongs to their account, and cannot
choose to show customers their legal name. On an agency profile customers see the pseudonym, or a
stand-in code while there is none. A pseudonym may not share a word with the investigator's legal name
or contain contact details.

## When do customers find an agency investigator?

When the profile is shown to customers, verified and accepting work, the investigator's account is
active, and the agency itself is active on the platform. Customers find them through search and the
assistant like any other investigator, with your agency's name beside them: the name on your
published agency profile, or your registered name while that profile is not published.

If your agency is suspended or archived, all its investigators leave search and suggestions on the
next search, and come back when the agency is active again.

## What happens to a profile when its investigator is suspended or leaves?

When the agency suspends or removes a member, the profile they hold is taken off the listing straight
away: it goes back to hidden and stops accepting work. While they are suspended or gone, it cannot be
shown to customers or set to accept work again; the rest of it can still be edited. If the member is
reactivated, the profile stays hidden until an owner or admin shows it again.

## Can an investigator quote on behalf of the agency?

Yes, with the profile the agency holds for them, once it is shown, verified and accepting work, and
if their role in the agency lets them quote. The quote is the agency's, with that investigator named
on it. Their own profile from their Personal workspace is never used for agency work.

Choosing another colleague as the lead investigator on a quote is not available yet.
