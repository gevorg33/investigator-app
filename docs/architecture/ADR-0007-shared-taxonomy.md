---
adr: 0007
title: One shared taxonomy for mission categories and investigator specialties
status: Accepted
date: 2026-09-13
supersedes: —
superseded_by: —
related:
  - plan.md §8, §9
  - .claude/skills/investigator-discovery/SKILL.md
  - .claude/skills/localization/SKILL.md
---

# ADR-0007 — One shared taxonomy

**Status:** Accepted · **Date:** 2026-09-13

## Context

A mission carried a **Category**, chosen by the customer. An investigator declared
**Specialties**. Nothing defined how the two related.

If a mission is *Corporate due diligence* and an investigator declares *Financial
investigation*, do they match? That was undefined — and it is the **core matching mechanism of
the marketplace**. Eligibility, discovery ranking, mission routing, notifications and the
moderation queue all depend on the answer.

A third term, `Service`, had also appeared in the discovery skill's filter contract without
existing in the data model at all.

## Decision

**One taxonomy. Both sides draw from it.**

A mission declares the node it falls under. An investigator declares the nodes they practise
in. Matching is an **exact join over node IDs**, not a mapping between vocabularies that
nobody owns.

`Service` is folded in. A service is a more specific node, not a separate dimension — the
distinction between "what kind of investigation" and "what specific thing you do" is a matter
of depth in the tree, not of kind. `serviceIds` is removed from the discovery contract.

### Shape

Hierarchical, so a customer can choose coarsely and an investigator can declare precisely:

```
corporate
  └── due-diligence
        ├── pre-acquisition
        └── counterparty
surveillance
  └── ...
```

A mission at a parent node matches investigators declared at any descendant. An investigator at
a parent is taken to cover its descendants. Matching walks the tree; it does not require both
sides to pick the same depth.

### Rules

1. **Stable IDs. Nodes are never deleted**, only deprecated. A mission or profile referencing a
   node from two years ago must stay valid — a deleted node silently breaks historical records
   and any matching that depended on them.
2. **Labels are translation keys**, per `localization`: canonical data is language-neutral, and
   the node ID is the canonical value. A node's Armenian label is not a different node.
3. **Staff-maintained.** `plan.md` §23 already assigns category and translation management to
   staff. Adding a node is a deliberate, audited change, not a free-text entry.
4. **The taxonomy gates eligibility.** It is a hard filter, applied in SQL
   (`investigator-discovery`).

## Tags are a separate thing, and they never gate

Tags are free-form refinement on top of the taxonomy — a lighter vocabulary for search and
ranking.

**Tags rank. They never determine eligibility.** Same rule as the free-text `relevanceHint`:
an investigator cannot become eligible for work because of a tag, and cannot be excluded from
work they are qualified for because one is missing.

Tags are curated rather than free text written by customers. Customer-authored free-text tags
on a mission would be a policy surface — someone will eventually tag a mission with something
that has to be moderated — and in three locales they become unusable for matching anyway.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Two vocabularies with a mapping table | The mapping becomes a third thing to maintain, and every ambiguity in it is a missed match or a wrong one. Nobody owns it |
| Flat list, no hierarchy | Forces customer and investigator to pick at the same granularity. Customers think coarsely, investigators precisely |
| Free-text tags as the matching mechanism | Unusable across three locales, and a moderation surface |
| Separate `Service` dimension | A second axis to keep aligned with the first, for a distinction that is really tree depth |

## Consequences

**Accepted:** one tree to design carefully up front, since both sides depend on it · a
taxonomy change is a staff operation with migration implications · coarse customer choices may
match broadly until the tree is refined.

**Gained:** matching is an exact join, not a heuristic · one vocabulary to translate · no
mapping table to drift · `Service` ambiguity resolved · tags can be added freely without
touching eligibility.

## Revisit when

Real usage shows customers and investigators genuinely think in different vocabularies — at
which point the answer is still one taxonomy, presented differently to each side, rather than
two.
