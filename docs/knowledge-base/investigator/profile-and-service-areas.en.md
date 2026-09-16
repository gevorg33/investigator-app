---
id: kb-investigator-profile-service-areas
title: Your profile, specialties, service areas and availability
audience: investigator
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-14
source_of_truth: database
implementation_status: specified
related_code:
  - apps/api/src/modules/profiles
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

A radius must be at least 5 km and at most 300 km. A drawn region must be at least as large as
a 5 km circle, have a single outline without holes, and use no more than 200 points.

Define them where you actually work, not where you would consider working. An area you
cannot reach reliably produces missions you decline, and a high decline rate affects how
missions are routed to you. Refusals on substantiated policy grounds are excluded from that —
see "Does refusing on policy grounds hurt my record?" in the assignments article.

## Can I have more than one service area?

Yes, up to 10, covering where you genuinely work. They can overlap.

You appear once per customer search regardless of how many of your areas match — the
nearest is used for distance ordering. Adding overlapping areas does not increase your
visibility.

## Which parts of my profile can customers see?

Customers see your storefront: display name, headline, description, years of experience,
specialties, languages, pricing model and rate, availability windows, and whether you are
currently accepting work.

They do not see your phone number. Contact happens through the platform, and your number is
there for staff and support rather than for customers.

Nothing is shown to customers unless it is on that list. New fields are invisible to
customers until they are deliberately added to it, so a setting that appears in your own
view has not quietly become public.

## When does my profile become visible?

Not when you activate the investigator role — only when you publish it. A new profile starts
as a draft, so you can fill it in over several sittings without a half-finished version
appearing in results.

An unpublished profile is not merely hidden. To anyone else it does not appear to exist at
all, which is deliberate: a response distinguishing "this person has an unpublished profile"
from "no such profile" would let anyone confirm you work here.

Publishing is not the same as being verified. They are separate, and verification has its own
process.

## Is my home address visible to customers?

No. Your home address is never asked for and never stored. Service areas are about where you
work, and several protections keep an area from revealing where you live even if you centre
it close to home:

- **The centre of a radius area is stored only to about a kilometre.** Whatever point you
  choose is rounded before it is saved.
- **No area can be smaller than a 5 km radius** — or, for a region you draw, smaller than the
  same area — so an area cannot be drawn tightly around one building.
- **Customers never see the shape of your areas.** Results show how far you are, rounded up to
  whole kilometres, not where your areas are drawn.

Even so, if you would rather your working area were not associated with your home, centre it
on the town or district you work in rather than your street.

## What is the difference between a specialty and a service?

A specialty is the kind of investigation — the domain you work in. A service is a specific
thing you do within it.

Customers filter on both. Declaring a specialty you do not actually offer services in
produces mismatched missions; declaring services you cannot lawfully perform in a declared
area is a compliance problem, not just a mismatch.

## How do I work as a customer as well?

The same account. Activating the customer role adds it to the account you already have — you
do not register again, and you switch between the two workspaces without signing in again.

This matters beyond convenience. Two accounts would mean two identities, two verification
histories and two reputations for one person, and nothing tying them together.

While you are working in one role, the platform acts as though you hold only that one. Your
investigator profile is not reachable from the customer workspace, which keeps the two sides
of your account from blurring together.

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
