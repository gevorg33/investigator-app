import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
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
    /**
     * Where this area is, as text, for the country/region/city filters discovery offers
     * (plan.md §9). Geography answers "within 20 km of this point"; it cannot answer "in
     * Armenia" without a country table nobody has built.
     *
     * Nullable, because T-009 shipped areas before these existed and never asked for them. An
     * area with no country simply does not match a country filter — the filter narrows, and an
     * unanswered question is not a match.
     */
    countryCode: text('country_code'),
    region: text('region'),
    city: text('city'),
    /** RADIUS only. Coarsened to two decimal places (about a kilometre) before it is stored. */
    centre: geographyPoint('centre'),
    radiusM: integer('radius_m'),
    /** What search runs against: the drawn boundary, or the buffered radius. */
    area: geographyPolygon('area').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the profile by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    tenantId: uuid('tenant_id').notNull().default(sql`app_current_tenant()`),
  },
  (t) => [
    // GIST, always: without it every coverage query is a sequential scan of every area.
    index('service_areas_area_gist').using('gist', t.area),
    index('service_areas_profile_idx').on(t.profileId),
    // Country is a hard filter applied before any geography (postgis-search).
    index('service_areas_country_idx').on(t.countryCode, t.city),
    foreignKey({
      name: 'service_areas_profile_tenant_fk',
      columns: [t.profileId, t.tenantId],
      foreignColumns: [investigatorProfiles.id, investigatorProfiles.tenantId],
    }).onDelete('cascade'),
    index('service_areas_tenant_idx').on(t.tenantId),
  ],
);
