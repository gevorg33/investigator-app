# Investigator discovery

How a customer finds investigators. Built in T-011. Procedures:
`.claude/skills/investigator-discovery/SKILL.md` and `.claude/skills/postgis-search/SKILL.md`.
Geography itself is `service-areas.md`.

## The pipeline, in this order

```
hard filters   country / region / city / taxonomy (incl. tree) / language / availability / pricing
  → eligibility  published · VERIFIED · accepting work · account ACTIVE and not deleted
  → geography    ST_DWithin filters; ST_Distance only sorts
  → quality      experience, where no location decided the order
  → projection   public fields only
```

**Every stage narrows or reorders. No stage adds.** Eligibility is in the SQL `WHERE`, not a
pass afterwards, so there is no filter combination, cursor or ranking signal that can produce an
ineligible result. A test asserts exactly that: a profile matching on language, category,
availability, price and distance still does not appear if it is unverified.

## Not RAG

Every fact discovery filters on is a column. Similarity search cannot answer "who speaks
Armenian" (an exact question), cannot know kilometres, and cannot enforce verification — an
unverified investigator whose profile text reads well would surface. Free-text relevance may
only reorder an already-eligible set; the assistant's `searchInvestigators` tool does exactly that
over this service's results (T-018, `assistant-tools.md`).

The request DTO therefore has **no free-text field** and **no verification filter**. Verification
is not a preference a customer expresses; the only value it could take is `VERIFIED`, and
offering it as a filter would imply otherwise.

## Eligibility

| Condition | Why |
|---|---|
| `visibility = 'PUBLISHED'` | A draft profile does not exist as far as anyone else is concerned |
| `verification_status = 'VERIFIED'` | plan.md §9. Staff grant it; nobody arrives holding it |
| `accepting_work = true` | The investigator's own switch |
| `users.status = 'ACTIVE'` and `deleted_at IS NULL` | A suspended or deleted account never appears |

**T-011 added the `verification_status` column** as a structural subset — T-013 owns the queue,
the documents and the decisions. Until T-013 ships nobody is `VERIFIED`, so discovery lists
nobody. That is the correct direction for an eligibility gate to fail, and it is why the column
could not wait for the task that fills it.

Verification is enforced in the **coverage query too** (`service-areas.md`), not only here.
"Never appears by any path" is only true if every path enforces it.

## The taxonomy walks the tree both ways

ADR-0007: a customer asking about `corporate` reaches an investigator who declared
`corporate/due-diligence`, and one asking about `corporate/due-diligence` reaches an
investigator who declared `corporate`. The requested nodes are expanded — descendants **and**
ancestors — by one recursive query, and the result set is matched against declared specialties.

A node id that does not exist matches nothing, rather than everything.

## Filter semantics, decided deliberately

| Filter | Semantics |
|---|---|
| `languages` | **All** of them. Someone who needs Armenian *and* English needs both |
| `taxonomyNodeIds` | **Any** of them, plus the tree walk. Categories are alternatives |
| `availableDuring` | **Overlap**, not containment — a customer asking about Tuesday morning wants anyone free for part of it |
| `city` / `region` | Case-insensitive. Neither side should have to guess the other's capitalisation |
| country / region / city | Matched against a **service area**, so they mean "works there", not "lives there" |

An area with no country declared does not match a country filter. An unanswered question is not
a match; the filter narrows.

## Geography and privacy

`ST_DWithin` filters with a constant distance so the GIST index is usable; `ST_Distance` only
ever sorts. A query-plan test seeds several thousand areas and asserts from `EXPLAIN` that the
index is used — and that the `ST_Distance`-in-`WHERE` form cannot use it even with sequential
scans disabled.

Results carry a **distance rounded up to whole kilometres** and nothing else geographic: no
centre, no boundary, no area label. An investigator with several overlapping areas appears
**once**, at their nearest.

Search is `POST /search/investigators`, not `GET`. A location search carries coordinates, and
coordinates do not belong in URLs, access logs or analytics.

## Paging

Cursor-based, per `docs/api/pagination.md`. The cursor encodes one ascending sort key plus the
profile id that breaks its ties, and is **bound to the filters that produced it** by a hash: a
cursor from one filter set applied to another is rejected rather than silently reinterpreted,
which would skip rows nobody could account for.

A cursor is opaque and is not a capability — it addresses a position in a result set the caller
could reach anyway. Every malformed, foreign or invented cursor gets the same
`VALIDATION_FAILED`.

An oversized `limit` is **clamped, not rejected**, which is why the DTO carries no maximum.

## Quality ranking is a stage with nothing in it yet

With a location, results are ordered by distance. Without one, by declared experience. Rating,
review count, response time and completion rate belong in this stage. Reviews exist since T-037,
and a profile's rating summary is computed from them (`reviews.md`), but the order does not use it
yet: changing who customers see first is gated, and is T-140. Response time and completion rate are
not collected. Ordering by a quality signal the platform has not collected would be inventing one,
so the stage stays empty rather than filled with a proxy.

## The match explanation

Each result carries `matchedOn` as data — the specialties that satisfied the taxonomy filter,
the requested languages the investigator works in, the place filters their area satisfied, and
whether an availability window matched. Whatever renders it may phrase it naturally but may not
add a reason that is not there; that is how invented qualifications reach a customer.

`matchedOn` reports only what was asked for. A search with no language filter reports no
language match rather than listing every language the investigator speaks.

Each result also carries `notMatched.taxonomyNodeIds` (T-018): the **requested** specialties this
investigator does not reach through the tree. Specialties are alternatives, so someone offering one
of two requested services is listed, with the other stated as a gap rather than left unsaid. No
other filter can have a gap — every one of them must be met, or the investigator is not listed. A
requested node that does not exist is not reported as missing.

The assistant finds investigators through this same service, as a registered tool:
`assistant-tools.md`.
