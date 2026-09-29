import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * The transactional outbox (`.claude/skills/background-jobs/SKILL.md`).
 *
 * A domain change and its event are written in one transaction, so an event exists exactly
 * when the change committed. The dispatcher (T-082) reads unpublished rows in the system context,
 * hands each off as a job in the workspace that produced it, and marks it published.
 *
 * Who produced it — workspace, user, membership — is filled from the context by DEFAULT, never by
 * the caller, and is how the event's work runs later with that producer's authority re-read. A row
 * written by the system itself (a payment turning into an assignment) has none, and its work runs
 * as the system. Row-level security admits a write in the producer's own workspace, and a read
 * only in the system context (migration 0032).
 *
 * Payloads carry references — ids, statuses, versions — never content. A consumer that needs
 * the mission reads it from PostgreSQL, where authorization applies.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: text('correlation_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** Set by the relay once delivered. Delivery is at-least-once; consumers are idempotent. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** The producer's workspace, user and membership; null when the system produced it. */
    tenantId: uuid('tenant_id').default(sql`app_current_tenant()`),
    userId: uuid('user_id').default(sql`app_current_user()`),
    membershipId: uuid('membership_id').default(sql`app_current_membership()`),
  },
  (t) => [
    // The relay's only query: the oldest unpublished events.
    index('outbox_events_unpublished_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} IS NULL`),
    index('outbox_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
);
