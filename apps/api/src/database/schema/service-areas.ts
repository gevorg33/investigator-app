import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { investigatorProfiles } from './profiles';
import { geographyPoint, geographyPolygon } from './types';

export const serviceAreaKind = pgEnum('service_area_kind', ['RADIUS', 'POLYGON']);

/**
 * Where an investigator works (plan.md §9, postgis-search).
 *
 * Two shapes, because investigators think in both: a centre with a radius, or a drawn
 * boundary. Search runs against one column for both, `area`. A radius is stored as its
 * buffered polygon, because `ST_DWithin` can use the GIST index only with a constant
 * distance — testing each row against its own radius would scan the whole table.
 *
 * There is no home location anywhere in the schema. The privacy rules that keep a service
 * area from revealing one — a coarsened centre, a minimum size — are CHECK constraints in the
 * migration, so they hold for every writer, not only this service.
 */
export const serviceAreas = pgTable(
  'service_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'cascade' }),
    kind: serviceAreaKind('kind').notNull(),
    /** What the investigator calls the area — "Yerevan", "Shirak region". */
    label: text('label').notNull(),
    /** RADIUS only. Coarsened to two decimal places (about a kilometre) before it is stored. */
    centre: geographyPoint('centre'),
    radiusM: integer('radius_m'),
    /** What search runs against: the drawn boundary, or the buffered radius. */
    area: geographyPolygon('area').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // GIST, always: without it every coverage query is a sequential scan of every area.
    index('service_areas_area_gist').using('gist', t.area),
    index('service_areas_profile_idx').on(t.profileId),
  ],
);
