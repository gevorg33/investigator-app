import { and, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { oauthAttempts } from '../../database/schema';
import type { HeldBy, RetentionSweep } from './retention-guard';

/** How often a rule's sweep runs. Hourly: a row is never more than an hour past its period. */
const HOURLY = 60 * 60 * 1000;

/**
 * A retention rule as code (T-204): what it removes, after how long, how often it looks, and every
 * resource a row belongs to — a hold on any of them keeps the row. **The one place a period is
 * set**: `docs/compliance/retention.md` names this file, and `retention-rules.spec.ts` holds each
 * period equal to the register's, so neither can change without the other — and rule 4 there says a
 * shortened period needs a recorded decision.
 */
interface RetentionRuleDef {
  readonly table: PgTable;
  /** The register's period, in days. */
  readonly periodDays: number;
  readonly everyMs: number;
  /** The rows past their period, given it. */
  readonly due: (periodDays: number) => SQL;
  readonly heldBy: readonly [HeldBy, ...HeldBy[]];
}

const ago = (days: number) => sql`now() - make_interval(days => ${days})`;

/**
 * Only rules whose period is not waiting on counsel. retention.md marks the rest provisional and
 * says not to build an irreversible deletion against them, so `job_runs`, `notifications`,
 * `idempotency_keys` and `outbox_events` get theirs when the period is decided (T-204).
 */
export const RETENTION_RULES = {
  /** A sign-in with a provider (T-062): hashes of single-use secrets, kept a day past their use. */
  'retention.oauth_attempts': {
    table: oauthAttempts,
    periodDays: 1,
    everyMs: HOURLY,
    due: (days) =>
      and(
        lt(oauthAttempts.expiresAt, ago(days)),
        or(isNull(oauthAttempts.signupExpiresAt), lt(oauthAttempts.signupExpiresAt, ago(days))),
      )!,
    // A LINK attempt belongs to the account it links; a sign-in has no account yet.
    heldBy: [{ type: 'USER', column: oauthAttempts.userId }],
  },
} as const satisfies Record<`retention.${string}`, RetentionRuleDef>;

export type RetentionRule = keyof typeof RETENTION_RULES;

export const RETENTION_RULE_NAMES = Object.keys(RETENTION_RULES) as RetentionRule[];

/** The sweep a rule runs, at its period. */
export function sweepOf(rule: RetentionRule): RetentionSweep {
  const def: RetentionRuleDef = RETENTION_RULES[rule];
  return { rule, table: def.table, due: def.due(def.periodDays), heldBy: def.heldBy };
}
