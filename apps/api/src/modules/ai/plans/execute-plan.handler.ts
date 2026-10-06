import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../database/database.module';
import { envelopeFor, type JobEnvelope, type JobHandler } from '../../../common/jobs/job';
import { JobQueue } from '../../../common/jobs/job-queue';
import type { EventSubscriber, OutboxEvent } from '../../../common/jobs/outbox-delivery.handler';
import { PLAN_CONFIRMED } from './ai-plans.service';
import { PlanExecutor } from './plan-executor';

export const EXECUTE_PLAN = 'ai.plan.execute';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ExecutePlan {
  readonly planId: string;
  /** The confirming request's id (T-212). Absent from a job queued before it. */
  readonly correlationId?: string;
}

/**
 * Hands a confirmed plan to the worker (T-048). Runs in the producer's context — the person who
 * confirmed — so the job it queues is theirs, in their workspace, re-read when it runs. Keyed on the
 * plan: however often the confirmation is delivered, the plan is queued as one job.
 */
export class PlanConfirmedTrigger implements EventSubscriber {
  readonly eventType = PLAN_CONFIRMED;

  constructor(private readonly queue: JobQueue) {}

  async handle(event: OutboxEvent): Promise<void> {
    const { planId, correlationId } = event.data as ExecutePlan;
    await this.queue.enqueue(
      'events',
      envelopeFor(EXECUTE_PLAN, `ai-plan-${planId}`, {
        planId,
        ...(correlationId !== undefined && { correlationId }),
      }),
    );
  }
}

/**
 * Runs one confirmed plan (`PlanExecutor`). The plan's own status commits with the job's claim in
 * `tx`; each step's progress is the executor's to persist as it goes, which is how a replacement
 * worker resumes rather than repeats.
 */
@Injectable()
export class ExecutePlanHandler implements JobHandler<ExecutePlan> {
  readonly command = EXECUTE_PLAN;
  readonly queue = 'events' as const;

  constructor(private readonly executor: PlanExecutor) {}

  parse(payload: unknown): ExecutePlan {
    const p = payload as Record<string, unknown> | null;
    const planId = p?.['planId'];
    const correlationId = p?.['correlationId'];
    if (typeof planId !== 'string' || !UUID.test(planId)) throw new Error('not a plan');
    if (correlationId === undefined) return { planId };
    if (
      typeof correlationId !== 'string' ||
      correlationId.length < 1 ||
      correlationId.length > 200
    ) {
      throw new Error('not a plan');
    }
    return { planId, correlationId };
  }

  /** Under the confirming request's id; a job from before T-212 has only its own. */
  async run(payload: ExecutePlan, tx: Tx, envelope: JobEnvelope<ExecutePlan>): Promise<void> {
    await this.executor.run(payload.planId, tx, {
      correlationId: payload.correlationId ?? envelope.jobId,
    });
  }

  /** Failed for good: the plan ends, saying how far it got — never left CONFIRMED (T-224). */
  async onDeadLetter(
    payload: ExecutePlan,
    tx: Tx,
    envelope: JobEnvelope<ExecutePlan>,
  ): Promise<void> {
    await this.executor.abandon(payload.planId, tx, {
      correlationId: payload.correlationId ?? envelope.jobId,
    });
  }
}
