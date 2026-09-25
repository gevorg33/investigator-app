---
id: kb-customer-finding-investigator
title: How investigators are matched to your mission
audience: customer
visibility: authenticated
locale: en
version: 3
status: current
updated: 2026-09-25
source_of_truth: database
implementation_status: implemented
related_code:
  - apps/api/src/modules/search
  - apps/api/src/modules/service-areas
  - apps/api/src/modules/ai/tools
tags: [discovery, investigators, location, specialties]
---

# Finding an investigator

> `source_of_truth: database` — this document explains how matching works. It must never
> list individual investigators, their locations, specialties or availability. Those are
> queried live. See `.claude/skills/investigator-discovery/SKILL.md`.

## How are investigators matched to my mission?

Matching applies your requirements as filters. The place you need, the specialty — the kind of
investigation or service — the languages you need, and the weekly hours you need someone
available are all requirements. Only investigators who are verified, whose account is active,
whose profile is published and who are currently accepting work are considered at all.

Those who match are ordered by distance from your location when you give one, and otherwise by
declared years of experience. When you describe the kind of experience you want, the assistant
may put those whose own profile description fits it best first — but only among investigators
who already meet every requirement. Ratings do not change the order: you see an investigator's
rating on their profile, to help you choose, but not to decide who is shown. Response times are not
collected.

An investigator who does not meet a requirement will not appear, however well their profile
description matches.

## Can I find investigators near a specific place?

Yes. Investigators define the areas they serve, either as a location with a working radius or as
a drawn region. If you share a location, results are restricted to investigators whose service
area covers it — or comes within the distance you choose — ordered by distance. Distances are
rounded up to whole kilometres, and an investigator's own location is never shown.

If you ask for someone near you without sharing a location or naming a place, you will be asked
for one: "nearest" has no answer without it. If you simply do not mention a place, the search
covers every area and says so, and you can narrow it afterwards.

## What can I filter by?

Country, region or city served; a location and a distance around it; investigation specialty;
the languages the investigator must speak — all of them, not just one; and the weekly hours you
need them available.

When you ask for several specialties, an investigator who offers any of them can appear, and you
are told which of the ones you asked for they do not offer.

## Why was a particular investigator suggested?

Every suggestion states which of your requirements it met — the specialty, the languages, the
place, the distance, the hours you asked about — and which of the specialties you asked for it
does not offer. Those reasons come from the investigator's declared profile, never from a
description written by the assistant.

## Why can't the assistant tell me an investigator's price?

Investigators price each mission in a quote. Some show an hourly rate on their profile, but the
assistant does not state prices: a rate is not what your mission will cost, and a figure the
assistant repeated would read as one. Request quotes to receive real prices.

## What if no investigator matches?

The assistant says it found nobody and shows what it searched for, so you can widen the area,
change the hours or reconsider the specialty. It does not widen the search on its own.

If your request is for something the platform does not allow, you will be told directly rather
than shown a shorter list.
