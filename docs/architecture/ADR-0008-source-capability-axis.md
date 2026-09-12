---
adr: 0008
title: Source capability as a second, investigator-only axis
status: Accepted
date: 2026-09-13
supersedes: —
superseded_by: —
related:
  - docs/architecture/ADR-0007-shared-taxonomy.md
  - docs/product/taxonomy-draft.md
  - .claude/skills/investigator-discovery/SKILL.md
---

# ADR-0008 — Source capability axis

**Status:** Accepted · **Date:** 2026-09-13

Extends ADR-0007. Does not supersede it: the shared taxonomy remains the matching mechanism.

## Context

Narrowing the platform to public and authorised information made the domain nodes less
differentiated. `corporate/due-diligence` and `screening/counterparty` now draw on much the same
material, and every branch leans on open-source research.

A restructure of the tree around **sources** was considered. It describes what the platform now
does far more honestly than a domain tree does.

It was rejected as *the* taxonomy for one reason:

> **Customer:** "I'm acquiring a company in Armenia — check the owners."
>
> Domain tree → `corporate/due-diligence`. One click.
> Source tree → `public-registers` + `court-legal` + `open-source` + `financial-trails`.

To navigate a source tree, a customer must already know how the investigation would be
conducted. They are hiring an expert because they do not. **Sources describe supply; domains
describe demand.** One tree cannot be both.

## Decision

Two axes, each doing one job.

| Axis | Declared by | Role |
|---|---|---|
| **Taxonomy** (domains, ADR-0007) | Customers **and** investigators | **Matching** — the exact join. Gates eligibility |
| **Sources** | **Investigators only** | Capability, feasibility routing, ranking. **Never gates** |

Customers never pick sources. A mission's likely sources are inferred from its taxonomy node
and jurisdiction, as a routing hint.

### Source tree

```
public-registers     corporate-filings · beneficial-ownership · land-property ·
                     vehicle · intellectual-property · licensing-regulatory
court-legal          court-records · judgments-enforcement · insolvency · sanctions-watchlists
open-source          media-publications · online-presence · domain-technical · archives
financial-trails     blockchain · published-financials · credit-filings
authorised           client-records · client-premises · consented-third-party
human-consensual     interviews
```

These are the scope made legible: every node is public information or information the
requesting party is authorised to provide.

### Sources are jurisdiction-scoped

This is where the axis earns its place. Access to corporate filings in Armenia is not access to
them in Germany. An investigator declares **(source node, jurisdiction)** pairs.

That makes feasibility routable: a mission needing Armenian land records reaches investigators
who have declared it, rather than failing after someone has already quoted.

## Why this is not the second axis ADR-0007 rejected

ADR-0007 rejected a separate `Service` dimension. That was two names for **the same kind of
thing** at different depths — what work is — and keeping two such vocabularies aligned is
thankless and drifts.

Sources are a different kind of thing: **what access and capability an investigator has**, not
what the work is. The two axes describe different subjects, so there is nothing to keep
aligned.

### The taxonomy→source mapping is a hint, not a determination

A staff-maintained mapping suggests likely sources for a taxonomy node in a jurisdiction. If it
is wrong, routing is suboptimal — not incorrect. That is a materially different failure mode
from a vocabulary mapping, where an error produces a missed or wrong match.

## Rules

1. **Sources never gate eligibility.** They rank and route. An investigator qualified by
   taxonomy is not excluded for having declared fewer sources, and no source declaration makes
   an unqualified investigator eligible. Same rule as tags.
2. **Self-declared initially**, and labelled as such. Verified source access can come later;
   claiming it must not silently read as verified.
3. **Jurisdiction-scoped**, always. An unqualified source declaration is meaningless.
4. **Staff-maintained vocabulary**, like the taxonomy. Not free text.

## Consequences

**Accepted:** a second vocabulary to maintain and translate · a mapping to curate · self-declared
capability is a claim, not a fact, until verification exists.

**Gained:** customers keep a navigable tree · investigators differentiate on real capability
rather than all claiming the same specialty · missions route by feasibility · the scope becomes
legible in the product itself.

## Revisit when

Source declarations are verifiable — at which point a verified source could reasonably become a
hard filter for missions that genuinely cannot proceed without it. That would be a change to
rule 1 and needs its own decision.
