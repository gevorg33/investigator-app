import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Append-only. The application role gets SELECT and INSERT only — never UPDATE or
 * DELETE (see migration 0000, and the test that proves the grant holds).
 *
 * An audit log that can be edited is not evidence of anything. Corrections append a
 * correcting entry; history is never rewritten (audit-logging).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correlationId: text('correlation_id'),

    // Nullable — a system actor has no user. Deliberately NOT a foreign key: the
    // entry must survive deletion of the user, which is the point of an audit log.
    actorId: uuid('actor_id'),
    // Captured as values, not by reference. Roles change; the entry must stay true
    // about what the actor was at the time.
    actorRole: text('actor_role'),
    staffScope: text('staff_scope'),

    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),

    // References, never content. No tokens, no evidence bytes, no message bodies.
    previousState: jsonb('previous_state'),
    newState: jsonb('new_state'),
    reason: text('reason'),

    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_logs_actor_idx').on(t.actorId, t.occurredAt),
    index('audit_logs_resource_idx').on(t.resourceType, t.resourceId),
    index('audit_logs_correlation_idx').on(t.correlationId),
    index('audit_logs_occurred_idx').on(t.occurredAt),
  ],
);
