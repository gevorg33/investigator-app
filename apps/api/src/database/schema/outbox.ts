import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * The transactional outbox (`.claude/skills/background-jobs/SKILL.md`).
 *
 * A domain change and its event are written in one transaction, so an event exists exactly
 * when the change committed. A relay publishes unpublished rows and marks them; that relay
 * arrives with BullMQ (T-036). Until then rows accumulate unpublished, which loses nothing.
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
  },
  (t) => [
    // The relay's only query: the oldest unpublished events.
    index('outbox_events_unpublished_idx')
      .on(t.occurredAt)
      .where(sql`${t.publishedAt} IS NULL`),
    index('outbox_events_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
);
