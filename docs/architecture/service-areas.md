# Service areas

Where investigators work, and how a location is matched against it. Procedure:
`.claude/skills/postgis-search/SKILL.md`. Built in T-009.

## Model

| Kind | Stored as | Searched as |
|---|---|---|
| `RADIUS` | coarsened centre + radius | the centre buffered to a polygon |
| `POLYGON` | the drawn boundary | the boundary |

Both are searched through a single `area geography(Polygon, 4326)` column with a GIST index.
A radius is stored buffered because `ST_DWithin` can use the index only with a **constant**
distance — testing each row against its own radius cannot, and would scan every area.

## The coverage query

```sql
SELECT sa.profile_id, min(ST_Distance(sa.area, :point)) AS distance_m
FROM service_areas sa
JOIN investigator_profiles ip ON ip.id = sa.profile_id
WHERE ip.visibility = 'PUBLISHED' AND ip.accepting_work = true
  AND ST_DWithin(sa.area, :point, :search_radius_m)   -- filters, index-usable
GROUP BY sa.profile_id                                 -- one result per investigator
ORDER BY distance_m, sa.profile_id                     -- ST_Distance only sorts
LIMIT :limit
```

- **`ST_DWithin` filters; `ST_Distance` only sorts.** `WHERE ST_Distance(...) < x` cannot use
  the index. A test seeds thousands of areas and asserts from `EXPLAIN` that the index is used —
  and that the `ST_Distance` form is not able to use it.
- **Several areas, one result.** Grouping keeps the nearest, so overlapping areas do not list the
  same investigator repeatedly or raise their visibility.
- `search_radius_m` of **0** means the point must fall inside an area — what the investigator
  article promises. Discovery may widen it, up to 100 km.
- Verification status joins the filter when it exists (T-013). Discovery composes the rest
  (T-011): hard filters, then geography, then ranking — never the other way round.

## Home locations are not discoverable

No home location is stored anywhere. That alone is not enough, because a service area can give
one away. Each of these closes one route:

| Route to a home | Closed by |
|---|---|
| A small radius centred on the house | Centres stored to **2 decimal places (≈1.1 km)**; minimum radius **5 km** |
| A tiny drawn square around it | Minimum area of a 5 km circle for **drawn** areas too (see below) |
| Triangulating a centre from exact distances returned by repeated searches | Distances leave the service **rounded up to whole kilometres** |
| Reading another investigator's geometry | No route returns anyone else's areas; coverage returns an id and a distance, nothing else |
| Coordinates in logs or analytics | Coordinates travel in request bodies, never URLs |

The coarsening and minimum size are **CHECK constraints** in migration 0006, so they hold for
every writer — not only this service. The service coarsens first so a request gets a clean
answer, and the database refuses anything that slips past.

### Calibrating the minimum area

PostGIS buffers geography through a local projection chosen by longitude band, so the area of a
5 km buffer depends on where it is. Measured on a global grid (every 22.5° of longitude, every 5°
of latitude), against 78,539,816 m² for a true circle:

- Smallest: **77,948,988 m²**, at (0.5, 0), (90.5, 0), (-89.5, 0) and (-179.5, 0).
- Largest: 78,097,887 m², at latitude 70.
- The low values fall on **four of every sixteen grid longitudes — a 90° pattern — in every band
  from 35°S to 35°N**. At Yerevan's longitude on the equator the same buffer is 78,092,596 m².

The constraint is **77,500,000 m²** — below every real 5 km buffer, and still over 98% of a true
circle.

It was first set at 78,000,000 from a single buffer at latitude 40, a 0.12% margin. That refused
genuine 5 km areas for anyone near those longitudes in the tropics and subtropics — 60 of 560 grid
points. It was caught only because the query-plan test seeded areas at random coordinates.

The regression test uses **measured coordinates**, (0.5, 0), (90.5, 0) and (-179.5, -5). A first
version picked random longitudes, mostly missed the affected bands, and passed against the broken
constraint — so it could not have caught the bug. The fixed version was run against the old
constraint and failed, then against the new one and passed.

## Other limits

At most 10 areas per investigator; a drawn boundary has 3–200 points, one ring, no holes, and
must be valid; radius 5–300 km.

## A fix made on the way

The `geographyPoint` column type written in T-004 parsed only `POINT(…)` text. postgres.js
returns geography as hex EWKB, so reading any geography row through drizzle would have thrown —
unnoticed, because nothing had yet read one the way application code does. It now reads the
binary (both byte orders, with or without an SRID, refusing truncated, trailing, 3D and non-finite
values), with a regression test that failed before the fix. A `geographyPolygon` type was added
alongside it.
