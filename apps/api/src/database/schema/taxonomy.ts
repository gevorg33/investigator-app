import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, integer } from 'drizzle-orm/pg-core';

export const taxonomyNodeStatus = pgEnum('taxonomy_node_status', ['ACTIVE', 'DEPRECATED']);

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
    parentId: uuid('parent_id').references((): never => taxonomyNodes.id as never, {
      onDelete: 'restrict',
    }),
    status: taxonomyNodeStatus('status').notNull().default('ACTIVE'),
    /** Display order among siblings. */
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('taxonomy_nodes_slug_unique').on(t.slug),
    index('taxonomy_nodes_parent_idx').on(t.parentId),
  ],
);
