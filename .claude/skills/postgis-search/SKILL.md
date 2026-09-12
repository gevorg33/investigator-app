---
name: postgis-search
description: Geographic search for investigator discovery — geography columns, GIST indexes, ST_DWithin distance filters, service-area polygons, and the hard-filter-before-ranking order. Use when implementing discovery, service areas, or any location query.
---

# PostGIS & discovery

## Discovery order (plan.md §9)

```
Hard filters          country, verification status, specialty, language, availability
  → eligibility       licensing, suspension, capacity
  → geographic        ST_DWithin against service area or radius
  → semantic rank     optional relevance layer
  → quality rank      rating, response time, completion rate
```

Each stage only narrows or reorders what the previous stage allowed. **Semantic relevance
never adds a result that a hard filter excluded.** An unverified investigator does not
surface because their profile text matched well.

## Types

`geography(Point, 4326)` for locations, not `geometry`. Geography does spherical maths, so
`ST_DWithin` takes metres and distances are correct without picking a projection.

Service areas are either a point plus a radius, or a `geography(Polygon, 4326)` for a
drawn area. Support both; investigators think in both.

## Indexes

```sql
CREATE INDEX CONCURRENTLY idx_service_areas_geog
  ON service_areas USING GIST (area_geog);
```

GIST, always. Without it every query is a sequential scan over the whole table.

## Query shape

```sql
SELECT ip.id, ST_Distance(sa.area_geog, $1::geography) AS distance_m
FROM investigator_profiles ip
JOIN service_areas sa ON sa.investigator_id = ip.id
WHERE ip.verification_status = 'VERIFIED'
  AND ip.deleted_at IS NULL
  AND ip.accepting_work = true
  AND ST_DWithin(sa.area_geog, $1::geography, $2)   -- index-usable
ORDER BY distance_m
LIMIT 50;
```

**`ST_DWithin` filters; `ST_Distance` only sorts.** A `WHERE ST_Distance(...) < x` cannot
use the index and will scan the table — this is the single most common PostGIS mistake.

## Privacy

Investigator *service areas* are discoverable. Investigator home locations are not — store
them separately, or store only the service area.

Mission coordinates are stored only when lawful and necessary for the mission, at the
coarsest precision that works. A city centroid is usually enough; a rooftop-accurate
coordinate for a person's home is a liability. Never expose a customer's precise location
to an investigator who has not been assigned.

Do not put coordinates in URLs, query strings, logs, or analytics events.

## Correctness traps

- Longitude comes first: `ST_MakePoint(lon, lat)`. Reversing it puts Yerevan in the ocean.
- Distances are metres with `geography`, degrees with `geometry`. Mixing them silently
  gives absurd results.
- An investigator with several service areas must appear once — deduplicate, keeping the
  nearest, or the list is misleading.
- Antimeridian and polar cases: geography handles them; hand-rolled bounding boxes do not.

## Checklist

- [ ] `geography(Point, 4326)`, longitude first
- [ ] GIST index exists
- [ ] `ST_DWithin` filters, `ST_Distance` sorts
- [ ] Hard filters applied before ranking
- [ ] Semantic relevance cannot add an ineligible result
- [ ] Multiple service areas deduplicated
- [ ] No precise personal location stored, exposed, or logged unnecessarily
