---
id: kb-investigator-profile-service-areas
title: Your profile, specialties, service areas and availability
audience: investigator
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-12
source_of_truth: database
implementation_status: specified
related_code:
  - apps/api/src/modules/investigator-profiles
  - apps/api/src/modules/service-areas
tags: [profile, service-areas, specialties, availability, languages, discovery]
---

# Profile and service areas

> This article explains how these settings work. The values — which specialties, which
> areas, who is available — live in your profile and are queried live.

## What determines whether I appear in a customer's results?

Your declared settings, checked as hard requirements: the area you cover, your specialties,
the services you offer, your languages, your availability, and your verification status.

Failing any one of them removes you from that customer's results entirely. Profile prose
does not compensate — descriptions affect ordering among investigators who already qualify,
never whether you qualify.

## How do service areas work?

A service area is either a location with a working radius, or a region you draw. A customer's
requested location must fall inside one of your areas for you to appear.

Define them where you actually work, not where you would consider working. An area you
cannot reach reliably produces missions you decline, and a high decline rate affects how
missions are routed to you. Refusals on substantiated policy grounds are excluded from that —
see "Does refusing on policy grounds hurt my record?" in the assignments article.

## Can I have more than one service area?

Yes, as many as you genuinely work in. They can overlap.

You appear once per customer search regardless of how many of your areas match — the
nearest is used for distance ordering. Adding overlapping areas does not increase your
visibility.

## Is my home address visible to customers?

No. Service areas are what customers see, and they are about where you work, not where you
live.

Define your service area around a working reference point rather than your home if the two
are the same place and you would rather they were not associated.

## What is the difference between a specialty and a service?

A specialty is the kind of investigation — the domain you work in. A service is a specific
thing you do within it.

Customers filter on both. Declaring a specialty you do not actually offer services in
produces mismatched missions; declaring services you cannot lawfully perform in a declared
area is a compliance problem, not just a mismatch.

## Why does availability matter so much?

Because customers filter on it, and because a mission with a timeframe you cannot meet is
wasted effort for both of you.

Keep it current. Availability that says you are free when you are not is the most common
reason an investigator receives missions they immediately decline.

## Which languages should I list?

The ones you can conduct the work and write the report in — not ones you can manage
socially.

Customers filter on language because they need to be understood and to read what you
produce. The platform supports English, Russian and Armenian in its interface; the languages
you work in are a separate declaration.

## Does my profile description affect whether I get work?

It affects ordering among investigators who already meet the customer's hard requirements,
and it affects whether a customer chooses you once they see you.

It cannot get you into a result set you do not qualify for. Write it for the human deciding
between two qualified investigators, which is the decision it actually influences.

## Why am I not receiving any missions?

Check, in this order: verification status, whether your service areas cover places customers
are asking about, whether your availability is current, and whether your specialties and
services match how customers describe their needs.

Most cases are one of those four rather than a shortage of work.
