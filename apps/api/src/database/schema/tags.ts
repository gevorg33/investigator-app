import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { missions } from './missions';
import type { TaxonomyLocale } from './taxonomy';

export const tagStatus = pgEnum('tag_status', ['ACTIVE', 'DEPRECATED']);

/**
 * The curated tag vocabulary (T-055): refinement on top of the taxonomy, never a replacement for
 * it. Staff maintain it; customers and moderators only pick from it — a free-text tag in three
 * locales is unusable for matching, and a customer-written one is a moderation surface.
 *
 * Never deleted, only deprecated. A **merged** tag is deprecated with `merged_into_id` naming the
 * tag that replaces it, and the missions that carried it are never rewritten: a filter on the
 * surviving tag follows the chain and finds them (docs/architecture/taxonomy.md, "Tags").
 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Language-neutral, and fixed for good, as a taxonomy node's slug is. */
    slug: text('slug').notNull(),
    status: tagStatus('status').notNull().default('ACTIVE'),
    /** Set once, when this tag is merged into another; it is deprecated from then on. */
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => tags.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('tags_slug_unique').on(t.slug),
    // Serves the merge closure: which tags were merged into this one.
    index('tags_merged_into_idx').on(t.mergedIntoId),
  ],
);

/** What a tag is called, per locale; a missing translation falls back to English. */
export const tagLabels = pgTable(
  'tag_labels',
  {
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'restrict' }),
    locale: text('locale').notNull().$type<TaxonomyLocale>(),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tagId, t.locale] })],
);

/**
 * A tag on a mission (T-055). The customer **suggests** while drafting; a moderator **confirms**
 * when publishing (T-051's decision). Only a confirmed tag is seen by anyone but the customer and
 * staff, and only on a mission the reader can already see — a tag narrows browse and orders it,
 * and never decides who sees a mission at all.
 */
export const missionTags = pgTable(
  'mission_tags',
  {
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'restrict' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'restrict' }),
    /** When the customer suggested it; null for a tag the moderator added. */
    suggestedAt: timestamp('suggested_at', { withTimezone: true }),
    /** When a moderator confirmed it, publishing the mission. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    // Not a foreign key, as in mission_status_history: the record outlives the account.
    confirmedBy: uuid('confirmed_by'),
    /**
     * Copied from the mission by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    primaryKey({ columns: [t.missionId, t.tagId] }),
    // Serves the customer's own read of a mission's tags.
    index('mission_tags_tenant_mission_idx').on(t.customerTenantId, t.missionId),
    // Serves browse's tag filter: the missions carrying a tag.
    index('mission_tags_tag_idx').on(t.tagId),
    foreignKey({
      name: 'mission_tags_mission_tenant_fk',
      columns: [t.missionId, t.customerTenantId],
      foreignColumns: [missions.id, missions.customerTenantId],
    }).onDelete('restrict'),
  ],
);
