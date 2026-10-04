import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { aiSessions } from './ai-sessions';
import { tenants } from './tenants';
import { userRoleName, users } from './users';

/**
 * Where a plan is in its life (T-048). `PROPOSED` waits for its person; `CONFIRMED` is queued;
 * `EXECUTING` has started; `COMPLETED` and `FAILED` are where it ran to; `CANCELLED` never ran (or
 * stopped before its next step) — the confirmation status says why.
 */
export const aiPlanStatus = pgEnum('ai_plan_status', [
  'PROPOSED',
  'CONFIRMED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

/**
 * The confirmation, kept apart from the plan's progress because it is what authorizes it.
 * `PENDING` until the person answers; `CONFIRMED` once, for this plan's hash; `DECLINED` by them;
 * `INVALIDATED` by a re-check before execution (the plan or what it acts on changed); `VOIDED` by
 * their leaving the workspace (T-085). Expiry is derived from `expires_at`, never stored.
 */
export const aiConfirmationStatus = pgEnum('ai_confirmation_status', [
  'PENDING',
  'CONFIRMED',
  'DECLINED',
  'INVALIDATED',
  'VOIDED',
]);

export const aiPlanStepStatus = pgEnum('ai_plan_step_status', [
  'PENDING',
  'RUNNING',
  'DONE',
  'FAILED',
  'SKIPPED',
]);

/**
 * What the assistant proposes to do, persisted before anyone confirms it (ADR-0006, ADR-0012,
 * T-048) — so a confirmation survives a closed browser, a restarted API and a restarted worker,
 * and is checked again against the database before anything runs.
 *
 * **Private as its session**: its own user, in its own workspace (row-level security), erased with
 * the session. A plan from one workspace is not visible in another, so neither is its confirmation.
 *
 * `plan_hash` covers the plan's id, its session and every step — tool, arguments and the state each
 * acted on when proposed. A confirmation is given for that hash and no other.
 */
export const aiPlans = pgTable(
  'ai_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`)
      .references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`)
      .references(() => users.id, { onDelete: 'restrict' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'restrict' }),
    planHash: text('plan_hash').notNull(),
    status: aiPlanStatus('status').notNull().default('PROPOSED'),
    confirmationStatus: aiConfirmationStatus('confirmation_status').notNull().default('PENDING'),
    /** Unconfirmed past this, the plan cannot be confirmed: what it was about may have moved on. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** The role the person had narrowed to when they confirmed; execution acts as it or not at all. */
    confirmedRole: userRoleName('confirmed_role'),
    /** Why it was cancelled or failed, as a code — never free text. */
    reason: text('reason'),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Serves AiPlansService.list(): a session's plans, newest first.
    index('ai_plans_session_idx').on(t.sessionId, t.createdAt),
    // Serves the T-085 trigger: a departing member's open plans in that workspace.
    index('ai_plans_owner_open_idx')
      .on(t.tenantId, t.userId)
      .where(sql`${t.status} IN ('PROPOSED', 'CONFIRMED')`),
  ],
);

/**
 * One command in a plan, in order (T-048). What it is — tool, arguments, the state it saw — is
 * fixed when proposed, and a trigger keeps it so: the hash the person confirmed is over exactly
 * this. Only its progress changes, step by step, and is persisted as it goes, so a worker that
 * dies is replaced by one that resumes rather than repeats.
 */
export const aiPlanSteps = pgTable(
  'ai_plan_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => aiPlans.id, { onDelete: 'restrict' }),
    /** Copied from the plan by trigger, so the step is erased with its session. */
    sessionId: uuid('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'restrict' }),
    ordinal: integer('ordinal').notNull(),
    tool: text('tool').notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull(),
    /** A digest of the state the step acts on, as the tool observed it when proposed. */
    observed: text('observed').notNull(),
    status: aiPlanStepStatus('status').notNull().default('PENDING'),
    /** The tool's output projection — what its schema lets leave, nothing more. */
    result: jsonb('result').$type<Record<string, unknown>>(),
    /** An error code, never a message: a message can quote the row. */
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`),
  },
  (t) => [unique('ai_plan_steps_plan_ordinal_unique').on(t.planId, t.ordinal)],
);

/**
 * A tool's result too large to put in front of a model, kept whole and referenced by id (ADR-0006,
 * T-048): the model sees a summary and the first page, then asks for the next. Ten thousand rows
 * never enter a prompt. Written once, never changed, erased with its session.
 */
export const aiToolResults = pgTable(
  'ai_tool_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => aiSessions.id, { onDelete: 'restrict' }),
    tool: text('tool').notNull(),
    /** What the whole result is, in a few fields — the tool's own summary, never the rows. */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull(),
    items: jsonb('items').$type<unknown[]>().notNull(),
    total: integer('total').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    tenantId: uuid('tenant_id')
      .notNull()
      .default(sql`app_current_tenant()`),
    userId: uuid('user_id')
      .notNull()
      .default(sql`app_current_user()`),
  },
  // Serves deletion with the session (SESSION_CONTENT).
  (t) => [index('ai_tool_results_session_idx').on(t.sessionId)],
);
