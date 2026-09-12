# Pagination and filtering

**Cursor-based. Not offset.** Offset pagination skips and duplicates rows as data changes
underneath it, and on a large table it degrades — both matter here, because evidence lists and
mission searches change while a user is reading them.

## Request

```
GET /api/v1/missions?limit=25&cursor=eyJpZCI6...
```

| Parameter | Rule |
|---|---|
| `limit` | Default 25, **maximum 100**. A request above the maximum is clamped, not rejected |
| `cursor` | Opaque. Clients must not parse, construct or modify it |

There is no unbounded list endpoint. An unbounded `limit` is an availability problem and, on
any endpoint touching personal data, a bulk-extraction problem — `platform-security-review`
checks for it.

## Response

```json
{
  "items": [ ... ],
  "pageInfo": { "nextCursor": "eyJpZCI6...", "hasNextPage": true }
}
```

No total count by default. Counting a filtered set costs a second full scan; where a count is
genuinely needed it is a separate, explicitly requested, possibly approximate field.

`hasNextPage: false` ends the sequence. A `nextCursor` that returns zero items is a bug.

## Cursor construction

Encode the sort key plus a tiebreaker — always including a unique column, normally the ID.
Sorting by a non-unique column without a tiebreaker makes pagination non-deterministic and
rows will be skipped.

Cursors are scoped to the query that produced them. A cursor from one filter set applied to
another is rejected with `VALIDATION_FAILED`, never silently reinterpreted.

## Filtering

Filters are **typed and closed** — an enumerated set per endpoint, never a free-form query
object that reaches the database. A filter parameter that accepts a column name, an operator,
or raw text destined for a query is an injection surface.

Free text, where offered, is a single `q` parameter handled by full-text search, and on
discovery endpoints it can only **rank** — never widen eligibility. See
`investigator-discovery`.

## Authorization

Pagination runs **inside** the actor's scope, never as a filter applied after fetching. The
query is actor-scoped; the cursor cannot address a row the actor could not otherwise reach.

A cursor is not a capability. Receiving someone else's cursor must not grant access to
anything.
