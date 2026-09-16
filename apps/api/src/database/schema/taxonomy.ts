import {
  type AnyPgColumn,
  index,
  integer,
  pgEnum,
  pgTable,
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
 * This is the STRUCTURAL subset only. T-053 owns the rest — per-locale labels, risk bands,
 * tags, tree-walking matching, the admin surface, and seeding the actual tree, which waits
 * on domain and licensing review. It exists here because T-007 declares investigator
 * specialties, and a specialty pointing at nothing is not a specialty: without the table
 * the join column would be an id with no referent.
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
