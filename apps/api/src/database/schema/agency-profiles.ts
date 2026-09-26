import { sql } from 'drizzle-orm';
import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { mediaAssets } from './media';
import { tenantKind, tenants } from './tenants';

/**
 * An agency's public profile (T-084, tenancy.md §12): the projection anyone signed in may read
 * once it is published — its name as shown, a headline, an about text, and the logo and cover.
 * Nothing else the agency holds is reachable through it.
 *
 * One per agency, keyed by the workspace. `tenant_kind` is always AGENCY, and the composite key to
 * `tenants (id, kind)` is what holds that: a Personal workspace has no public profile.
 *
 * `display_name` null means "show the agency's registered name". The logo and cover must be this
 * agency's own `AGENCY_LOGO` / `AGENCY_COVER` files — the composite keys hold the workspace, a
 * trigger the category (migration 0024).
 */
export const tenantProfiles = pgTable(
  'tenant_profiles',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .default(sql`app_current_tenant()`),
    tenantKind: tenantKind('tenant_kind').notNull().default('AGENCY'),
    displayName: text('display_name'),
    headline: text('headline'),
    about: text('about'),
    logoMediaId: uuid('logo_media_id'),
    coverMediaId: uuid('cover_media_id'),
    /** Set while published; null is a draft, readable only inside the agency. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'tenant_profiles_tenant_kind_fk',
      columns: [t.tenantId, t.tenantKind],
      foreignColumns: [tenants.id, tenants.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tenant_profiles_logo_fk',
      columns: [t.logoMediaId, t.tenantId],
      foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'tenant_profiles_cover_fk',
      columns: [t.coverMediaId, t.tenantId],
      foreignColumns: [mediaAssets.id, mediaAssets.tenantId],
    }).onDelete('restrict'),
  ],
);

/**
 * A workspace's settings (T-084, tenancy.md §12): one row per section that has been saved. A
 * section with no row is its defaults — nothing has to be configured to use the product, and a
 * new setting needs no backfill. The shape of each section, and its defaults, are the API's
 * (`modules/tenants/settings/sections.ts`); the database holds which sections exist and that each
 * value is an object.
 */
export const tenantSettings = pgTable(
  'tenant_settings',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    section: text('section').notNull(),
    value: jsonb('value').notNull(),
    version: integer('version').notNull().default(1),
    /** Who last saved it. No foreign key, as in audit_logs: the setting outlives the account. */
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'tenant_settings_pk', columns: [t.tenantId, t.section] })],
);
