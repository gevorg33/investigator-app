import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { investigatorProfiles } from './profiles';
import { missions } from './missions';
import { quotes } from './quotes';
import { users } from './users';

/**
 * The assignment's own states. A **separate machine** from the mission's, as
 * `mission-state-machine` requires: a payment can fail while the mission sits in
 * CUSTOMER_CONFIRMED, and a policy halt is an assignment-level event with no mission meaning.
 *
 * PENDING_ACCEPTANCE — created and paid for; the investigator has a window to accept.
 *                      "Until you accept, the work is not yours."
 * ACCEPTED           — committed to the scope and price.
 * IN_PROGRESS        — work under way.
 * REPORT_SUBMITTED   — delivered; the customer reviews it.
 * COMPLETED          — closed, and what moves the assignment toward payout.
 * CANCELLED          — declined before acceptance, or cancelled after.
 * SUSPENDED          — a policy halt. Work stops, funds stay held, staff review.
 *
 * No document enumerated these; T-010's mission statuses came from plan.md §8 but the
 * assignment's were only ever implied. This set is the smallest that covers what the
 * knowledge base already promises, and adding to it is a plan change, not a code change.
 */
export const assignmentStatus = pgEnum('assignment_status', [
  'PENDING_ACCEPTANCE',
  'ACCEPTED',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
  'COMPLETED',
  'CANCELLED',
  'SUSPENDED',
]);

/** Who moved an assignment. SYSTEM has no user; STAFF records the scope it acted under. */
export const assignmentActorKind = pgEnum('assignment_actor_kind', [
  'CUSTOMER',
  'INVESTIGATOR',
  'STAFF',
  'SYSTEM',
]);

/**
 * The agreement between one customer and one investigator (plan.md §11).
 *
 * Created **only** after the customer accepts a quote and a payment authorization succeeds —
 * "until both have happened, no investigator is committed to the work and no assignment
 * exists" (`kb-customer-quotes-expiry`). Exactly once per mission, which `mission_id` being
 * unique enforces in the database rather than in a check somebody can forget.
 *
 * The commercial terms are **snapshotted from the quote**, not joined to it. The quote is the
 * agreement as it stood at acceptance; reading them back through a mutable row would let the
 * terms of a live assignment change underneath it.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // One mission produces one assignment. "If you need two investigators, you need two
    // missions." This is the exactly-once guarantee, held by a constraint.
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'restrict' }),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    investigatorProfileId: uuid('investigator_profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'restrict' }),

    status: assignmentStatus('status').notNull().default('PENDING_ACCEPTANCE'),
    /** Incremented by every write. A write that read an older version fails rather than overwrites. */
    version: integer('version').notNull().default(1),

    // ── The agreement, as accepted ──────────────────────────────────────────────
    acceptedScope: text('accepted_scope').notNull(),
    deliverables: text('deliverables').notNull(),
    assumptions: text('assumptions'),
    exclusions: text('exclusions'),
    cancellationTerms: text('cancellation_terms').notNull(),
    priceMinor: integer('price_minor').notNull(),
    currency: text('currency').notNull(),
    estimatedDurationDays: smallint('estimated_duration_days').notNull(),
    /** When the work is due, derived from the estimate at acceptance. */
    dueAt: timestamp('due_at', { withTimezone: true }),

    // ── The payment that made it exist ──────────────────────────────────────────
    /**
     * The provider's reference for the authorization. Opaque to this module: the payments
     * module (Phase 5) owns intents, webhooks, the ledger and fees. Stored so an assignment
     * can always be traced to the authorization that created it.
     */
    paymentReference: text('payment_reference').notNull(),
    paymentAuthorizedAt: timestamp('payment_authorized_at', { withTimezone: true }).notNull(),

    /** The window the investigator has to accept. Failing to accept releases the customer. */
    acceptanceDueAt: timestamp('acceptance_due_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the quote by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    /**
     * Copied from the quote by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    uniqueIndex('assignments_mission_unique').on(t.missionId),
    // A quote can produce only one assignment, for the same reason.
    uniqueIndex('assignments_quote_unique').on(t.quoteId),
    index('assignments_investigator_idx').on(t.investigatorProfileId, t.status),
    index('assignments_customer_idx').on(t.customerId, t.createdAt),
    foreignKey({
      name: 'assignments_quote_parties_fk',
      columns: [t.quoteId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [quotes.id, quotes.customerTenantId, quotes.supplierTenantId],
    }).onDelete('restrict'),
    unique('assignments_id_parties_unique').on(t.id, t.customerTenantId, t.supplierTenantId),
    index('assignments_customer_tenant_idx').on(t.customerTenantId, t.status),
    index('assignments_supplier_tenant_idx').on(t.supplierTenantId, t.status),
  ],
);

/**
 * Every status an assignment has held, who moved it and why. Append-only by grant, like the
 * mission's: a history that can be edited settles no dispute.
 */
export const assignmentStatusHistory = pgTable(
  'assignment_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    /** Null only for the row recording creation. */
    fromStatus: assignmentStatus('from_status'),
    toStatus: assignmentStatus('to_status').notNull(),
    actorKind: assignmentActorKind('actor_kind').notNull(),
    // Deliberately not a foreign key, as in audit_logs: history outlives the account.
    actorId: uuid('actor_id'),
    staffScope: text('staff_scope'),
    reason: text('reason'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Copied from the assignment by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    /**
     * Copied from the assignment by trigger `fill_party_from_parent`, never from the request, and
     * held equal to it by a composite foreign key (T-076). The default only makes it optional
     * to drizzle; the trigger always overwrites it.
     */
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    index('assignment_status_history_assignment_idx').on(t.assignmentId, t.occurredAt),
    foreignKey({
      name: 'assignment_history_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
  ],
);
