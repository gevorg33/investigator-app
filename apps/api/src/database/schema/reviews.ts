import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { assignments } from './assignments';
import { investigatorProfiles } from './profiles';
import { users } from './users';

/**
 * A customer's rating of a completed assignment (plan.md §8, T-037).
 *
 * One per assignment — held by a unique index, not a read-then-write check — and only once the
 * assignment is COMPLETED, which a trigger holds whoever the writer is. The rating is never
 * rewritten: a review that could be edited after an investigator replied would make the reply
 * answer something else. Staff may **remove** one, with a written reason, and nothing else.
 *
 * The rating is public — anyone signed in can read it once the investigator's profile is
 * published — so it counts the moment it is written. Text is not here: it lives in `review_texts`,
 * where it waits for moderation, so a policy can make unmoderated words invisible to every other
 * workspace rather than trusting a query to leave them out.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    /** Copied from the assignment by a trigger, never from the request. */
    investigatorProfileId: uuid('investigator_profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'restrict' }),
    rating: smallint('rating').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: uuid('removed_by').references(() => users.id, { onDelete: 'restrict' }),
    removalReason: text('removal_reason'),

    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    foreignKey({
      name: 'reviews_parties_fk',
      columns: [t.assignmentId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [assignments.id, assignments.customerTenantId, assignments.supplierTenantId],
    }).onDelete('restrict'),
    // Exactly once per assignment (T-037).
    uniqueIndex('reviews_one_per_assignment').on(t.assignmentId),
    // The target of review_texts' composite foreign key: a text's parties are its review's.
    uniqueIndex('reviews_id_parties_key').on(t.id, t.customerTenantId, t.supplierTenantId),
    // Serves ReviewsService.forProfile(): a profile's reviews, newest first, and its summary.
    index('reviews_profile_idx').on(t.investigatorProfileId, t.createdAt),
    index('reviews_customer_tenant_idx').on(t.customerTenantId),
    index('reviews_supplier_tenant_idx').on(t.supplierTenantId),
  ],
);

/** A review's words, or the investigator's one response to them. */
export const reviewTextKind = pgEnum('review_text_kind', ['REVIEW', 'RESPONSE']);

/**
 * Pre-moderation (owner decision, 2026-09-25): every text starts PENDING and is public only once
 * staff publish it. A report by the other party sends a published text back to PENDING.
 */
export const reviewTextStatus = pgEnum('review_text_status', ['PENDING', 'PUBLISHED', 'HIDDEN']);

/**
 * The words of a review, and of the investigator's response — one of each at most, both moderated.
 *
 * Kept apart from the rating so that row-level security, not a SELECT list, decides who reads what:
 * both parties read their texts in any state, staff read them to moderate, and everyone else reads
 * a text only while it is PUBLISHED and its review is readable to them. The body is never
 * rewritten; moderation and reporting change the status and say who, when and why.
 */
export const reviewTexts = pgTable(
  'review_texts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'restrict' }),
    kind: reviewTextKind('kind').notNull(),
    body: text('body').notNull(),
    status: reviewTextStatus('status').notNull().default('PENDING'),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    /** The latest moderation. Earlier ones are in the audit trail. */
    moderatedBy: uuid('moderated_by').references(() => users.id, { onDelete: 'restrict' }),
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderationReason: text('moderation_reason'),

    /** The latest report by the other party. Earlier ones are in the audit trail. */
    reportedBy: uuid('reported_by').references(() => users.id, { onDelete: 'restrict' }),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    reportReason: text('report_reason'),

    customerTenantId: uuid('customer_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    supplierTenantId: uuid('supplier_tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
  },
  (t) => [
    foreignKey({
      name: 'review_texts_parties_fk',
      columns: [t.reviewId, t.customerTenantId, t.supplierTenantId],
      foreignColumns: [reviews.id, reviews.customerTenantId, reviews.supplierTenantId],
    }).onDelete('restrict'),
    // One review text and one response per review (T-037: "may respond once").
    uniqueIndex('review_texts_one_per_kind').on(t.reviewId, t.kind),
    // Serves ReviewsService.moderationQueue(): pending texts, oldest first.
    index('review_texts_pending_queue_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
    index('review_texts_customer_tenant_idx').on(t.customerTenantId),
    index('review_texts_supplier_tenant_idx').on(t.supplierTenantId),
  ],
);
