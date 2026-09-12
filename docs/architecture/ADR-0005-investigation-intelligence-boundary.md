---
adr: 0005
title: Defer the investigation intelligence layer; keep v1 extensible without abstracting
status: Accepted
date: 2026-09-12
supersedes: —
superseded_by: —
related:
  - docs/architecture/ADR-0003-ui-stack.md
  - .claude/skills/evidence-integrity/SKILL.md
  - plan.md §8
---

# ADR-0005 — Investigation intelligence layer, deferred

**Status:** Accepted · **Date:** 2026-09-12

## Context

The UI plan proposed entity graphs, relationships, confidence scores, contradictions and
timeline events. `plan.md` §8 defines none of them. React Flow renders data; the data does
not exist.

Two failure modes are in play, and avoiding one usually walks into the other:

- **Build it now** — speculative schema and UI for a capability nobody has validated, paid for
  in every migration and every authorization check from here on.
- **Ignore it entirely** — v1 shapes itself such that adding the layer later means rewriting
  evidence, reporting and the AI surfaces.

## Decision

**Do not build the intelligence layer in v1. Do not add React Flow as a v1 dependency.**
Do not create entity, relationship, confidence or contradiction tables to satisfy a UI.

**And do not abstract for it either.** No interfaces with one implementation, no polymorphic
`entity_type`/`entity_id` columns, no extension points. Speculative abstraction costs clarity
today for a benefit that may never arrive.

Instead, five concrete constraints on v1 make the later addition cheap. Each is something v1
should do anyway on its own merits:

1. **Evidence items are stable, addressable and immutable.** Already required by
   `evidence-integrity`. A future `evidence_entities` join is then purely additive.
2. **Report findings reference evidence by ID, never embed copies.** Already required by
   `report-generation`. Entity-linked findings become an added column, not a migration of
   report content.
3. **Assertion class stays a column on findings** — `FACT` / `CLAIM` / `INFERENCE` /
   `HYPOTHESIS` / `UNKNOWN`, already specified. Confidence and contradiction attach to an
   existing classified row later, rather than requiring one to be introduced.
4. **Structure what is cheap to structure now.** If investigators record "the subject works at
   Acme LLC" only in freeform notes, a future migration has to parse prose. Where a field is
   obviously structured — a date, a place, a named organisation — capture it as a field.
5. **Keep intelligence concerns out of the evidence module.** A future `intelligence` module
   should be additive, not carved out of an evidence module that grew to own relationships.

That is the whole of "preserve the boundary". It is five constraints, four of which are
already written into existing skills.

## The rule this follows

```
Domain Model → Application Capability → UI → Visualisation
```

Never the reverse. The UI represents real capabilities over real data. A visual component is
never a reason to create a table.

## Future scope, recorded so it is not re-invented

```
Investigation Intelligence Layer  (not v1)
  Entity            Person | Organization | Location | Other
  Relationship      entity ↔ entity, typed, evidenced
  EvidenceEntity    evidence ↔ entity
  RelationshipEvidence
  Confidence        on an assertion, citing what produced it
  Contradiction     conflicting positions, unresolved by default
  TimelineEvent     dated, evidence-referenced
  Graph             visualisation over the above
```

When this is built, entity resolution must not silently merge entities — a match is an
assertion with evidence and a reason, per `evidence-integrity`. React Flow is then evaluated
as the visualisation layer, on the merits, with the data in hand.

## v1 scope

**An Assignment is the investigation.** No separate Investigation entity — the assignment
already carries the parties, the agreed scope, the state machine and the audit trail.

```
Assignment (the investigation)
  Evidence                  plan.md §8
  Reports                   plan.md §8
  AI Assistant              plan.md §16
  InvestigationSource       plan.md §8 — specified, T-031
  InvestigationNote         plan.md §8 — specified, T-032
  InvestigationTask         plan.md §8 — specified, T-032
  InvestigationDocument     plan.md §8 — specified, T-033
```

These four were specified rather than assumed, per this ADR's own rule. Two carry design
constraints worth restating:

- **Notes and tasks default to `private`.** Working material contains discarded lines of
  inquiry. A customer reading a dismissed hypothesis is the FACT/INFERENCE failure mode.
- **Documents are not evidence.** They may be promoted to evidence — one way, audited,
  checksum computed server-side at promotion. Evidence is never demoted. Without that
  boundary, evidence gets attached as documents and the chain of custody is lost.

## Consequences

**Accepted:** no graph in v1 · no relationship querying · contradictions remain a report-level
concern rather than a queryable record.

**Gained:** no speculative schema · no abstraction tax · the five constraints are things v1
wanted anyway · a written future scope, so the next agent extends rather than re-invents.

## Revisit when

Investigators are actually using v1 and the demand for relationship mapping is observed
rather than assumed — at which point this ADR is superseded by one that specifies the model.
