import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const taxonomyNodeStatus = pgEnum('taxonomy_node_status', ['ACTIVE', 'DEPRECATED']);

/**
 * How much scrutiny work under a node needs (docs/product/taxonomy-draft.md). Ordered: each band
 * is at least as sensitive as the one before it. It orders the moderation queue (T-051); it
 * never lets a mission skip review.
 *
 * RESTRICTED is surveillance of a private individual in a personal matter, including partner
 * investigation (ADR-0009) — moderated every time without exception.
 */
export const riskBand = pgEnum('risk_band', ['STANDARD', 'ELEVATED', 'HIGH', 'RESTRICTED']);

/**
 * One taxonomy, drawn from by both missions and investigator specialties (ADR-0007).
 *
 * Created by T-007, because a specialty pointing at nothing is not a specialty. T-053 added
 * per-locale labels and the staff write path (docs/architecture/taxonomy.md). The tree itself
 * is seeded by T-131, after the domain and licensing review in docs/product/taxonomy-draft.md;
 * tags are T-055's and the source axis (ADR-0008) is T-132's.
 *
 * `slug` and `parent_id` never change once written — a trigger holds it. The slug is the
 * language-neutral name the node is known by, and the parent is what matching walks: moving a
 * node would silently change which investigators every historical mission under it reached.
 *
 * Nodes are never deleted, only deprecated (ADR-0007 rule 1). A profile referencing a node
 * from two years ago must stay valid; deleting one silently breaks historical records and
 * any matching that depended on them.
 */
export const taxonomyNodes = pgTable(
  'taxonomy_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Language-neutral canonical value. A node's Armenian label is not a different node. */
    slug: text('slug').notNull(),
    // AnyPgColumn is drizzle's documented type for a self-reference. It replaces a double
    // `as never` cast, which compiled only because it switched type checking off.
    parentId: uuid('parent_id').references((): AnyPgColumn => taxonomyNodes.id, {
      onDelete: 'restrict',
    }),
    status: taxonomyNodeStatus('status').notNull().default('ACTIVE'),
    /** Display order among siblings. */
    position: integer('position').notNull().default(0),
    /**
     * Nullable until T-053 bands the reviewed tree. Mission screening treats an unbanded node
     * as HIGH: a band nobody has assigned is not evidence the work is low-risk.
     */
    riskBand: riskBand('risk_band'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('taxonomy_nodes_slug_unique').on(t.slug),
    index('taxonomy_nodes_parent_idx').on(t.parentId),
  ],
);

/** The locales a label can be written in (`localization`). English is the fallback. */
export const TAXONOMY_LOCALES = ['en', 'ru', 'hy'] as const;
export type TaxonomyLocale = (typeof TAXONOMY_LOCALES)[number];

/**
 * What a node is called, per locale (ADR-0007 rule 2, T-053).
 *
 * The node id is the canonical value; a label is how it reads. So a label can be corrected
 * without touching a single mission or specialty, and a missing translation falls back to
 * English rather than to a slug nobody should see.
 */
export const taxonomyNodeLabels = pgTable(
  'taxonomy_node_labels',
  {
    nodeId: uuid('node_id')
      .notNull()
      .references(() => taxonomyNodes.id, { onDelete: 'restrict' }),
    locale: text('locale').notNull().$type<TaxonomyLocale>(),
    label: text('label').notNull(),
    /** A sentence a customer reads when choosing, where the label alone is ambiguous. */
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.nodeId, t.locale] })],
);
