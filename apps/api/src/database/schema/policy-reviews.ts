import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assignments } from './assignments';
import { missions } from './missions';
import { users } from './users';

/** Which of the two refusal windows raised it (`mission-state-machine`). */
export const policyReviewKind = pgEnum('policy_review_kind', ['DECLINE', 'HALT']);

/** Whether the ground held up. The whole design turns on this (T-050). */
export const policyReviewFinding = pgEnum('policy_review_finding', [
  'SUBSTANTIATED',
  'UNSUBSTANTIATED',
]);

/** What happens to a halted assignment. A decline has none: it is already cancelled. */
export const policyReviewDisposition = pgEnum('policy_review_disposition', ['RESUME', 'CANCEL']);

/**
 * An investigator's lawful-grounds refusal, and staff's review of it (T&C §3, §4; T-050).
 *
 * Opened by a POLICY_CONCERN decline before acceptance, or a halt after it. Resolved once, by
 * moderation staff, with written reasoning: **substantiated** refusals do not count against the
 * investigator's response record, **unsubstantiated** ones do — the asymmetry that keeps a
 * good-faith refusal protected without making refusal a free exit.
 *
 * Readable by the investigator's workspace and staff, not by the customer: the ground can describe
 * the customer's own material as unlawful, and the customer learns of the review through the
 * assignment's status, not through the investigator's words.
 */
export const policyReviews = pgTable(
  'policy_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    /** The mission that worried the investigator — what a moderator reviews (T-051). */
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'restrict' }),
    kind: policyReviewKind('kind').notNull(),
    ground: text('ground').notNull(),
    raisedBy: uuid('raised_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    raisedAt: timestamp('raised_at', { withTimezone: true }).notNull().defaultNow(),

    finding: policyReviewFinding('finding'),
    /** Only on an unsubstantiated finding: the refusal was an excuse, not a mistake. */
    badFaith: boolean('bad_faith').notNull().default(false),
    disposition: policyReviewDisposition('disposition'),
    reasoning: text('reasoning'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),

    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    foreignKey({
      name: 'policy_reviews_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
    // One review in flight per assignment: a second halt while the first is unresolved is noise.
    uniqueIndex('policy_reviews_one_open')
      .on(t.assignmentId)
      .where(sql`${t.decidedAt} IS NULL`),
    index('policy_reviews_open_queue_idx')
      .on(t.raisedAt)
      .where(sql`${t.decidedAt} IS NULL`),
    index('policy_reviews_raised_by_idx').on(t.raisedBy),
    index('policy_reviews_supplier_tenant_idx').on(t.supplierTenantId),
  ],
);

/**
 * What happens to the customer's money, recorded **separately** from the halt or decline that
 * prompted it (`mission-state-machine`, T-050).
 *
 * A decision, not a movement: no payment provider is integrated yet (T-110 to T-113), so each row
 * says what is owed and `executed_at` stays empty until payments carries it out. Append-only; the
 * latest row for an assignment is the one in force.
 *
 * - FULL_REFUND — the customer gets everything back (a decline: no work was done)
 * - HOLD        — funds stay held while staff review (a halt)
 * - RESUME      — the hold ends; funds go back to the ordinary escrow of a live assignment
 * - SPLIT       — staff decided part is payable to the investigator for work lawfully done
 */
export const moneyDecisionKind = pgEnum('money_decision_kind', [
  'FULL_REFUND',
  'HOLD',
  'RESUME',
  'SPLIT',
]);

export const moneyDecisions = pgTable(
  'money_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    policyReviewId: uuid('policy_review_id').references(() => policyReviews.id, {
      onDelete: 'restrict',
    }),
    decision: moneyDecisionKind('decision').notNull(),
    /** SPLIT only: what the investigator is paid. The rest is refunded. */
    investigatorAmountMinor: integer('investigator_amount_minor'),
    currency: text('currency').notNull(),
    reason: text('reason').notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'restrict' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set once, by payments, when the money has actually moved. */
    executedAt: timestamp('executed_at', { withTimezone: true }),

    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    foreignKey({
      name: 'money_decisions_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
    index('money_decisions_assignment_idx').on(t.assignmentId, t.decidedAt),
    index('money_decisions_customer_tenant_idx').on(t.customerTenantId),
    index('money_decisions_supplier_tenant_idx').on(t.supplierTenantId),
  ],
);
