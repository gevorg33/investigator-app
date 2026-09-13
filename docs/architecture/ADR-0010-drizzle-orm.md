---
adr: 0010
title: Drizzle ORM for schema, queries and migrations
status: Accepted
date: 2026-09-13
related:
  - .claude/skills/db-migration/SKILL.md
  - .claude/skills/postgis-search/SKILL.md
  - .claude/skills/permission-aware-rag/SKILL.md
---

# ADR-0010 — Drizzle ORM

**Status:** Accepted · **Date:** 2026-09-13

## Context

`plan.md` never chose an ORM. The decision is expensive to reverse and was nearly
re-litigated twice while being made, so the reasoning is recorded in full.

The constraints that matter here: **PostGIS** for investigator discovery, **pgvector** for
permission-aware retrieval, **hand-written reversible migrations** (`db-migration`), and
**`GRANT` manipulation** to make `audit_logs` append-only.

## Decision

**Drizzle ORM `0.45.2` with drizzle-kit `0.31.10`**, over the `postgres` driver.

## The comparison, honestly

Prisma was excluded early: PostGIS `geography` and pgvector both need `Unsupported()` escape
hatches, and those two are central here rather than incidental.

TypeORM and Drizzle each win one of the two constraints:

| | PostGIS | pgvector | Stable line |
|---|---|---|---|
| TypeORM 1.1.1 | **`SpatialColumnOptions`** — built-in `spatialFeatureType`, `srid` | none; needs a third-party package | 1.0 shipped May 2026; 6 stable releases in 2026 |
| Drizzle 0.45.2 | `point`/`line` only — **native Postgres geometric types, not PostGIS**; needs a `customType` | **native `vector` type** + six typed distance functions | 1 stable release in 2026; 1.0 at `rc.5` |

Drizzle was chosen for pgvector ergonomics. The trade accepted with it:

- **A custom `geography` type is required.** Drizzle does not model PostGIS. Written once in
  `packages/db`, used everywhere.
- **The stable line is quiet** while 1.0 sits in RC. We pin `0.45.2` and do not take an RC into
  the layer everything depends on.

Worth keeping in proportion: both tools write raw SQL for the queries that actually matter.
`ST_DWithin(area, $1, $2)` is a function call, not a column type, and neither library types it.
The column-type advantage on either side is smaller than it first appears.

## Security — the reason for the constraints below

**CVE-2026-39356** (CVSS 7.5) — SQL injection through improperly escaped identifiers in
`sql.identifier()`, `.as()` and dynamic `orderBy`. Affected `< 0.45.2`; **patched in 0.45.2**,
which is the version pinned here.

Drizzle is safe by default: the `` sql`` `` template tag turns `${value}` into a bind
parameter. The danger is the escape hatches, so they are blocked by lint rather than by
convention:

- **`sql.raw()`** — no injection protection at all, by design
- **`sql.identifier()`** — the CVE surface

Both are banned outside an allowlisted file. Note that **no ORM can parameterise identifiers** —
Postgres does not permit it — so dynamic sorting stays a closed enum, per
`docs/api/pagination.md`.

## Consequences

**Accepted:** a hand-written `geography` type · a stable line with little recent movement · a
1.0 migration ahead of us.

**Gained:** native vector columns and distance functions for T-016/T-017 · readable generated
SQL migrations we can hand-edit for grants and expand/contract · strong type inference.

## Revisit when

Drizzle 1.0 ships stable — upgrading is then a deliberate task, not a drift. Or if the custom
`geography` type proves troublesome enough in T-009 to outweigh the pgvector gain.
