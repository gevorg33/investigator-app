---
id: kb-customer-finding-investigator
title: How investigators are matched to your mission
audience: customer
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-12
source_of_truth: database
implementation_status: specified
related_code:
  - apps/api/src/modules/search
  - apps/api/src/modules/service-areas
tags: [discovery, investigators, location, specialties]
---

# Finding an investigator

> `source_of_truth: database` — this document explains how matching works. It must never
> list individual investigators, their locations, specialties or availability. Those are
> queried live. See `.claude/skills/investigator-discovery/SKILL.md`.

## How are investigators matched to my mission?

Matching applies your requirements as filters, in a fixed order. First the hard
requirements: the country or area you need, the specialty your mission falls under, the
services you need, the languages you need, and availability in your timeframe. Only
investigators who are verified, not suspended, and currently accepting work are
considered. Remaining matches are then ordered by distance from your location, relevance
to your description, and quality signals such as rating and response time.

An investigator who does not meet a hard requirement will not appear, however well their
profile description matches.

## Can I find investigators near a specific place?

Yes. Investigators define the areas they serve, either as a location with a working radius
or as a drawn region. If you provide a location, results are restricted to investigators
whose service area covers it, ordered by distance. If you have not given a location, you
will be asked for one before distance-based results can be produced.

## What can I filter by?

Location and distance, the area or city served, investigation specialty, the specific
services offered, availability within your timeframe, and spoken languages. Additional
criteria may be available depending on the mission category.

## Why was a particular investigator suggested?

Every suggestion states which of your requirements it matched — for example the specialty,
the languages, the service area and the earliest available date — and which requirements it
did not meet. If a suggested investigator does not offer one of the services you asked for,
that is stated rather than omitted.

## Why can't the assistant tell me an investigator's price?

Investigators price each mission individually. There is no published rate the assistant can
read, so it will not estimate one. Request quotes to receive real prices.

## What if no investigator matches?

You may be asked to widen the area, adjust the timeframe, or reconsider the specialty. If
your mission falls into a category the platform does not support, you will be told
directly rather than shown unrelated matches.
