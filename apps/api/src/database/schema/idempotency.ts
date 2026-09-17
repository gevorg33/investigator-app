import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Client-supplied idempotency keys (docs/api/idempotency.md).
 *
 * Required on quote acceptance, assignment creation, payment confirmation, payout initiation
 * and refund issuance — "networks retry, users double-tap, providers redeliver webhooks".
 *
 * **The uniqueness is the mechanism, not a read-then-write check.** Read-then-write has a race
 * window and loses under exactly the concurrency it exists to handle. The key row and the
 * effect commit in the same transaction: a key recorded for work that rolled back would block
 * a legitimate retry, and an effect without its key would double-execute.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Scope is per actor, per endpoint: two actors may use the same key without colliding. */
    actorId: uuid('actor_id').notNull(),
    endpoint: text('endpoint').notNull(),
    key: text('key').notNull(),

    /**
     * A hash of the request body. A key bound to one request must never execute a different
     * one — replaying the same key with a different body is a 409, not a second effect.
     */
    requestFingerprint: text('request_fingerprint').notNull(),

    /** The stored response, replayed verbatim rather than re-executed. */
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),

    /**
     * Set when the work finishes. A row with no completion is a first call still running, and
     * a concurrent replay of it is refused as retryable rather than queued or run twice.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('idempotency_keys_scope_unique').on(t.actorId, t.endpoint, t.key),
    // Keys live at least 24 hours; the retention job finds expired ones by age.
    index('idempotency_keys_created_idx').on(t.createdAt),
  ],
);
