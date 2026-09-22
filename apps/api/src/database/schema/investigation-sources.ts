import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { assignments } from './assignments';
import { users } from './users';

/** What kind of place the information came from (plan.md §8). */
export const investigationSourceType = pgEnum('investigation_source_type', [
  'PUBLIC_RECORD',
  'REGISTRY',
  'WEBSITE',
  'WITNESS',
  'DOCUMENT',
  'OBSERVATION',
  'OTHER',
]);

/**
 * How far the investigator trusts the source — a property of the source, assessed once.
 *
 * Not the assertion-level confidence ADR-0005 defers, and must not grow into it: a HIGH source
 * can carry a wrong claim, and the question "how sure are we of this statement" belongs to the
 * finding that makes it (FACT / CLAIM / INFERENCE, `evidence-integrity`).
 */
export const sourceReliability = pgEnum('source_reliability', ['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);

/**
 * Where information in an assignment came from, distinct from the evidence obtained from it
 * (plan.md §8, T-031).
 *
 * **Assignment-scoped, never a catalogue.** A source reused across assignments would tell one
 * customer what another had investigated, so there is no path from one assignment's sources to
 * another's — not through the service, and not through the database: the row carries both
 * parties' workspaces, copied from its assignment, and row-level security reads them.
 *
 * **Private by default.** The investigator's workspace reads and writes; the customer's reads
 * only what the investigator has shared. A source can name a third party — a witness, a
 * neighbour — and a customer does not learn who unless the investigator decides.
 *
 * **Withdrawn, never deleted.** Evidence will cite sources (T-116), and a source that vanished
 * would leave evidence pointing at nothing. The runtime role holds no DELETE.
 *
 * The locator may be a URL. It is a record of where the investigator looked and is never fetched
 * by the server — `investigation-sources.module.spec.ts` holds that.
 */
export const investigationSources = pgTable(
  'investigation_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    type: investigationSourceType('type').notNull(),
    title: text('title').notNull(),
    /** A URL, a register reference, a file number — whatever lets someone find it again. */
    locator: text('locator'),
    /** When the investigator consulted it. A registry extract is only true as of a date. */
    accessedAt: timestamp('accessed_at', { withTimezone: true }),
    reliability: sourceReliability('reliability').notNull().default('UNKNOWN'),
    /** Required unless reliability is UNKNOWN: a judgement without its reason is an assertion. */
    reliabilityRationale: text('reliability_rationale'),
    /** Whether the customer's workspace may read it. Off until the investigator turns it on. */
    shared: boolean('shared').notNull().default(false),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    /** Copied from the assignment by trigger, and never changed (T-076). */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    // The parties must be the assignment's own: a row naming another pair of workspaces could
    // make a source readable where its assignment is not.
    foreignKey({
      name: 'investigation_sources_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
    index('investigation_sources_assignment_idx').on(t.assignmentId, t.createdAt),
    index('investigation_sources_supplier_tenant_idx').on(t.supplierTenantId),
    index('investigation_sources_customer_tenant_idx').on(t.customerTenantId),
  ],
);
