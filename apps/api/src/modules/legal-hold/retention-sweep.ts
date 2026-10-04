import { Injectable } from '@nestjs/common';
import { systemEnvelope, type JobEnvelope, type JobHandler } from '../../common/jobs/job';
import { JobQueue } from '../../common/jobs/job-queue';
import type { Tx } from '../../database/database.module';
import { RetentionGuard } from './retention-guard';
import {
  RETENTION_RULE_NAMES,
  RETENTION_RULES,
  sweepOf,
  type RetentionRule,
} from './retention-rules';

export const RETENTION_SWEEP = 'retention.sweep';

interface SweepPayload {
  rule: RetentionRule;
}

/**
 * One run of one retention rule (T-204): a system job on the `maintenance` queue, so the runner has
 * already crossed into the audited system context — one crossing per run, the job's own — and hands
 * over the transaction it claimed the run in. The guard sweeps in it; a rule the code no longer has
 * is refused, and the job goes to the dead letters rather than retrying.
 */
@Injectable()
export class RetentionSweepHandler implements JobHandler<SweepPayload> {
  readonly command = RETENTION_SWEEP;
  readonly queue = 'maintenance' as const;

  constructor(private readonly guard: RetentionGuard) {}

  parse(payload: unknown): SweepPayload {
    const rule = (payload as { rule?: unknown } | null)?.rule;
    if (!RETENTION_RULE_NAMES.includes(rule as RetentionRule)) {
      throw new Error('not a retention rule');
    }
    return { rule: rule as RetentionRule };
  }

  async run(payload: SweepPayload, tx: Tx, envelope: JobEnvelope<SweepPayload>): Promise<void> {
    await this.guard.sweep(tx, sweepOf(payload.rule), { correlationId: envelope.jobId });
  }
}

/**
 * Puts every retention rule on its schedule (T-204), when a worker starts: a BullMQ scheduler per
 * rule, named for it, at the rule's interval. Installing is idempotent and the schedule lives in
 * Redis, so any number of workers starting yield one run per interval. A scheduler for a rule no
 * longer in the code is removed, so taking a rule out stops it.
 */
@Injectable()
export class RetentionSchedule {
  constructor(private readonly jobs: JobQueue) {}

  async install(): Promise<{ scheduled: RetentionRule[]; removed: string[] }> {
    for (const rule of RETENTION_RULE_NAMES) {
      await this.jobs.schedule(
        'maintenance',
        rule,
        RETENTION_RULES[rule].everyMs,
        systemEnvelope(RETENTION_SWEEP, rule, { rule }),
      );
    }
    const removed = await this.jobs.unscheduleExcept(
      'maintenance',
      'retention.',
      RETENTION_RULE_NAMES,
    );
    return { scheduled: [...RETENTION_RULE_NAMES], removed };
  }
}
