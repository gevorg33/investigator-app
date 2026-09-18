import {
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { investigatorProfiles } from './profiles';
import { missions } from './missions';

/**
 * SUBMITTED  — a live offer the customer can accept until it expires.
 * WITHDRAWN  — the investigator pulled it before acceptance, usually to replace it.
 * ACCEPTED   — the customer accepted it. At most one per mission, enforced by an index.
 * CLOSED     — a sibling quote was accepted, so this one can no longer be.
 * EXPIRED    — its expiry passed. "Once a quote expires it cannot be accepted or reinstated."
 *
 * There is no DECLINED: nothing in the knowledge base promises a customer can reject a quote
 * individually, and a status nobody sets is a status that misleads whoever reads it next.
 */
export const quoteStatus = pgEnum('quote_status', [
  'SUBMITTED',
  'WITHDRAWN',
  'ACCEPTED',
  'CLOSED',
  'EXPIRED',
]);

/**
 * An investigator's formal offer for a mission (plan.md §11).
 *
 * **The quote is the agreement** — "what is not in it was not agreed"
 * (`kb-investigator-quoting`). So every field a dispute would turn on is stored here and
 * snapshotted onto the assignment at acceptance, rather than read back through a row the
 * investigator could later change.
 *
 * It holds the investigator's price only. Platform fees and taxes are shown to the customer
 * separately and are calculated by the payments module (Phase 5) — "your quote is what your
 * work is worth".
 */
export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    missionId: uuid('mission_id')
      .notNull()
      // restrict: a quote is part of the record of what was offered for this mission.
      .references(() => missions.id, { onDelete: 'restrict' }),
    investigatorProfileId: uuid('investigator_profile_id')
      .notNull()
      .references(() => investigatorProfiles.id, { onDelete: 'restrict' }),

    status: quoteStatus('status').notNull().default('SUBMITTED'),

    /** Minor units, integer. Money is never a float. */
    priceMinor: integer('price_minor').notNull(),
    /** ISO 4217. 5000 is not an amount without it. */
    currency: text('currency').notNull(),
    /** The investigator's own estimate for this scope — not a platform-wide timeframe. */
    estimatedDurationDays: smallint('estimated_duration_days').notNull(),

    /** What will be done, where, and what the customer receives. */
    scope: text('scope').notNull(),
    deliverables: text('deliverables').notNull(),
    /** What the investigator is relying on, and what they are not doing. */
    assumptions: text('assumptions'),
    exclusions: text('exclusions'),
    /** Governs the refund if the customer cancels, so it is part of the offer. */
    cancellationTerms: text('cancellation_terms').notNull(),

    /** Server-enforced. After this instant the quote cannot be accepted or reinstated. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The customer's list: every quote on their mission, newest first.
    index('quotes_mission_idx').on(t.missionId, t.createdAt),
    index('quotes_investigator_idx').on(t.investigatorProfileId, t.createdAt),

    // One live offer per investigator per mission. Replacing a quote means withdrawing it and
    // submitting another, which the partial predicate allows while this still refuses two.
    uniqueIndex('quotes_one_live_per_investigator')
      .on(t.missionId, t.investigatorProfileId)
      .where(sql`${t.status} = 'SUBMITTED'`),

    // **At most one accepted quote per mission, in the database.** "Accepting a quote creates a
    // single assignment for that mission." This index is what makes concurrent acceptance safe:
    // the loser's INSERT/UPDATE violates it rather than racing a read-then-write check.
    uniqueIndex('quotes_one_accepted_per_mission')
      .on(t.missionId)
      .where(sql`${t.status} = 'ACCEPTED'`),
  ],
);
