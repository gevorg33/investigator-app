---
id: kb-investigator-profile-service-areas
title: Your profile, specialties, service areas and availability
audience: investigator
visibility: authenticated
locale: en
version: 4
status: current
updated: 2026-09-26
source_of_truth: database
implementation_status: partial
related_code:
  - apps/api/src/modules/profiles
  - apps/api/src/modules/service-areas
  - apps/api/src/modules/taxonomy
  - apps/app-web/src/components/investigator
tags: [profile, service-areas, specialties, availability, languages, discovery, taxonomy]
---

# Profile and service areas

> This article explains how these settings work. The values — which specialties, which
> areas, who is available — live in your profile and are queried live.

## Where do I set up my profile?

In Account, open **Your investigator profile**. Everything that decides whether customers find
you is on that one page: what you say about yourself, your languages, specialties,
availability, the areas you work in, and verification.

At the top, **Getting listed** shows what is still to do — profile shown to customers, verified,
accepting new work, at least one language, one specialty and one area — and each item links to
where it is done. Two switches there are yours to flip at any time: **Show my profile to
customers** publishes or unpublishes your profile, and **Accepting new work** says whether you
are taking missions.

**Preview as a customer** shows your profile exactly as customers see it: the same fields, built
the same way. Anything not in the preview is not public.

Open missions are shown to you, and you can quote, once your profile is shown to customers,
verified and accepting new work. Until then the Missions page says so and links back here.

## What determines whether I appear in a customer's results?

Your declared settings, checked as hard requirements: the area you cover, your specialties,
your languages, your availability, and your verification status.

Failing any one of them removes you from that customer's results entirely. Profile prose
does not compensate — descriptions affect ordering among investigators who already qualify,
never whether you qualify.

## How do service areas work?

A service area is either a location with a working radius, or a region you draw. A customer's
requested location must fall inside one of your areas for you to appear.

A radius must be at least 5 km and at most 300 km. A drawn region must be at least as large as
a 5 km circle, have a single outline without holes, and use no more than 200 points.

Each area also names the country, and optionally the region and city, it covers. Customers
filter by those, and geography alone cannot answer "in Armenia" — so an area with no country
named does not appear in a search filtered by country, even when it covers the right place.
Name them for every area you want found that way.

Define them where you actually work, not where you would consider working. An area you
cannot reach reliably produces missions you decline, and a high decline rate affects how
missions are routed to you. Refusals on substantiated policy grounds are excluded from that —
see "Does refusing on policy grounds hurt my record?" in the assignments article.

## How do I add a service area?

On your profile, under **Where you work**, choose **Use my location**. Your browser asks once
for permission. The position is rounded to about a kilometre on your own device before it is
sent, so a more precise one never leaves it.

Then choose how far you travel — 5, 10, 25, 50 or 100 km — give the area a name for yourself,
and name the country and city it covers so customers filtering by them find you.

For now an area is added from where you are when you add it. Searching for a place, drawing an
area on a map, and radii other than those offered are not available on this page yet. If
location is blocked, allow it for the site in your browser settings and try again.

## Can I have more than one service area?

Yes, up to 10, covering where you genuinely work. They can overlap.

You appear once per customer search regardless of how many of your areas match — the
nearest is used for distance ordering. Adding overlapping areas does not increase your
visibility.

## Which parts of my profile can customers see?

Customers see your storefront: display name, headline, description, years of experience,
specialties, languages, pricing model and rate, availability windows, whether you are
currently accepting work, and whether you are verified. Only that last yes or no is shown: an
application under review and one that was not approved both read as not verified.

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

## Can I change my name?

Yes, until you apply for verification. Use the name on your identity document: verification
checks your documents against it.

While an application is under review, and once you are verified, your name is locked, because
it is the name your documents were checked against. To change it after that, contact support.

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

There is no separate list of services. Specialties form a tree: a broad kind of investigation,
and more specific kinds of work beneath it. What might be called a service is simply a deeper
specialty.

Declare as precisely as your work really is. Matching walks the tree in both directions: if you
declare a specific specialty, you match customers who chose it or the broader one above it; if
you declare a broad one, you match customers who chose anything beneath it. Declaring broadly
therefore brings you more missions, including ones that turn out to need something you do not
do — and declaring specialties you cannot lawfully practise in your declared areas is a
compliance problem, not just a mismatch.

## What happens when a specialty I declared is retired?

Nothing changes for you. A retired specialty disappears from the list new declarations are
chosen from, but you keep it: it stays on your profile, it still matches customers exactly as
before, and you can go on saving the rest of your profile with it in place.

What you cannot do is newly add a retired specialty. If you remove it, it cannot be added back.
Staff retire a specialty when the tree is reorganised; they do not remove one from anybody who
already declared it.

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
