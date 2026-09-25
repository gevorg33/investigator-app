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

## The customer's screen (T-120)

`/missions/investigators` in app-web, a customer's second view of Missions (`app-web.md`). It sends
exactly the typed filters above — country, city, one specialty, languages, a weekday (as
`availableDuring` over the whole day, which overlap turns into "free for part of it") and pricing
— and `near` + `radiusKm` only when the customer shares their location. Region is not offered: a
free-text region has no list to choose from, and country and city already cover the place.

**Coordinates never reach a URL** here either: filters live in the address, the location lives in
the page's memory, and the search is a `POST` from the browser. The device's position is rounded
to two decimals before it is sent, as service areas are. The map view waits for a map provider
(T-147).

---

# Investigators browsing missions (T-054)

The other direction: an investigator finding the published missions they could quote on.
`POST /api/v1/search/missions`, in the same module (`MissionBrowseService`), over PostgreSQL and
PostGIS, never RAG.

## Eligibility is the quote gate

```
requireQuotingProfile  active, INVESTIGATOR, investigations.create, own profile published + VERIFIED + accepting work
  → mission            status QUOTED, and not the investigator's own (one account holds both roles)
  → filters            taxonomy (tree), currency + budget overlap, deadline window, languages ⊆ chosen,
                       published within N days, ST_DWithin of the investigator's own service areas
  → order              newest | closest | budget | deadline | relevance, then newest, then id
  → projection         MissionListing — nothing about the customer
```

**Browse shows exactly what a quote would be accepted on.** `requireQuotingProfile`
(`profiles/quoting-eligibility.ts`) is one function called by both `QuotesService.submit` and the
browse, so the two cannot disagree. Specialties, areas and languages are **filters the investigator
chooses**, not eligibility (owner decision, 2026-09-25): narrowing eligibility to declared specialties
would show most investigators nothing until the real taxonomy is seeded (T-131), and would have to
change the quote gate with it — filed as T-143.

Eligibility sits in the SQL `WHERE` with the filters. Row-level security holds it a second time:
any workspace reads a mission only while it is QUOTED (`quoted_read`), so removing the status
condition from the query changes nothing for another workspace's missions — the mutation check in
`mission-browse.service.spec.ts` shows it. A test runs fifteen filter and sort combinations through
every page and asserts no draft, submitted, under-review, rejected, cancelled, confirmed or own
mission ever appears.

## Filter semantics

| Filter | Meaning |
|---|---|
| `taxonomyNodeIds` | Filed at, below or above a requested node — the same two-way walk as discovery (`taxonomy-closure.ts`) |
| `currency`, `budgetMinMinor`, `budgetMaxMinor` | Overlap with the mission's range, in one currency. A budget or the budget sort without a currency is refused — amounts in different currencies do not compare |
| `deadlineFrom`, `deadlineTo` | Inclusive dates |
| `languages` | Every language the mission requires is among those chosen (`<@`): a mission needing Armenian and English is not work for someone who ticked only English |
| `postedWithinDays` | Relative to now, so a saved search still means "recent" later |
| `serviceAreaId`, `withinKm` | Distance from the edge of the investigator's own area (one, or the nearest of them). `ST_DWithin` filters, `ST_Distance` only sorts. Someone else's area is refused |
| `q` | Orders by `ts_rank` over title and description (`simple` configuration, so no stemming yet). **Never filters.** It implies `sort: relevance`, and any other sort with it is refused — it would do nothing, silently |

A published mission always has a deadline, both ends of its budget, a currency and at least one
language (`missions_submission_complete`), so only location can be missing: missions without one
sort last under "closest" and are left out by a distance filter.

## Posted date

`missions.published_at` (migration 0023) is set by the trigger `missions_published_at` on every
entry into QUOTED — a writer cannot supply or change it — so "newest" and "posted within" need no
access to the status history, which only the customer's workspace can read. Existing published
missions were backfilled from that history.

## Paging

Keyset, on `(sort key, newest, id)`, with the cursor bound to the filters that produced it
(`encodeKeyset`/`decodeKeyset` in `search.policy.ts`): a cursor from one browse applied to another
is refused, as discovery's are.

## What a listing shows

`id, title, description, taxonomyNodeId, countryCode, locationLabel, distanceKm, startBy,
deadline, budgetMinMinor, budgetMaxMinor, currency, languages, publishedAt`. Not the customer, not
their purpose or relationship to the subject, not a protective-order declaration, never coordinates.
A test asserts the exact key set.

## Saved searches

`GET/POST /search/missions/saved`, `DELETE /search/missions/saved/:id`. Stored in
`saved_mission_searches` — own user in own workspace under row-level security, like assistant
conversations. The filters are checked exactly as a browse would check them before they are saved,
names are unique per owner, and one investigator keeps at most 20 (serialised by an advisory lock).
A saved search never holds a cursor. Listing stays open to an investigator whose eligibility has
lapsed; browsing does not.
