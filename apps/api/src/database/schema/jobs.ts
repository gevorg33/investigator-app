import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * A job that ran to completion (T-082): the check that makes a retry or a duplicate delivery do
 * nothing. Written in the same transaction as the job's effect, keyed on the job's business key
 * **within its workspace** — so it is the constraint, not a read-then-write, that decides whether
 * the work has already been done. A system job's run has no workspace, and is keyed among those.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The workspace the job ran in; null for a system job, which runs in none. */
    tenantId: uuid('tenant_id')
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    /** What the job is idempotent on — an outbox event's id, a payment's id. */
    jobKey: text('job_key').notNull(),
    command: text('command').notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // NULLS NOT DISTINCT: two system runs of the same key are the same run too.
    unique('job_runs_tenant_key_unique').on(t.tenantId, t.jobKey).nullsNotDistinct(),
  ],
);

/**
 * A job that failed for good (T-082) — out of attempts, or refused outright: its member removed,
 * its workspace suspended, its payload not what the command takes. Kept whole, with the context it
 * was queued in and the error, so it can be read and replayed once the cause is fixed. Written and
 * read in the system context only: a refused job has no workspace it may still act in.
 */
export const jobDeadLetters = pgTable(
  'job_dead_letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: text('job_id').notNull(),
    queue: text('queue').notNull(),
    command: text('command').notNull(),
    /** The context the job was queued in; null for a system job. */
    tenantId: uuid('tenant_id'),
    userId: uuid('user_id'),
    membershipId: uuid('membership_id'),
    payload: jsonb('payload').notNull(),
    /** Why it stopped — ours, never a provider's words. */
    error: text('error').notNull(),
    attempts: integer('attempts').notNull(),
    failedAt: timestamp('failed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Serves reading the dead letters newest first, and alerting on their count.
    index('job_dead_letters_failed_idx').on(t.failedAt),
  ],
);
