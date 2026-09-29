import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../../database/database.module';
import { jobDeadLetters } from '../../database/schema';
import { PlatformContext } from '../context/platform-context';
import { isEnvelope, PermanentJobError } from './job';

/** Long enough to say what broke; bounded, so a runaway message cannot fill the table. */
const MAX_ERROR = 500;

/** What a failure was, in our words: the permanent reason, or the error's name and message. */
export function describeFailure(error: unknown): string {
  const said =
    error instanceof PermanentJobError
      ? error.reason
      : error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
  return said.slice(0, MAX_ERROR);
}

/**
 * Jobs that failed for good (T-082): kept whole — the context they were queued in, the payload, why
 * they stopped and after how many attempts — so they can be read and replayed once the cause is
 * fixed. Written in the system context: a refused job has no workspace it may still act in.
 */
@Injectable()
export class DeadLetters {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly platform: PlatformContext,
  ) {}

  async record(data: unknown, queue: string, error: unknown, attempts: number): Promise<void> {
    // What came off the queue may not even be an envelope; it is kept as it arrived all the same.
    const e = isEnvelope(data) ? data : undefined;
    // Awaited inside: a Drizzle query is lazy, and runs in whatever context awaits it — outside
    // the system context, row-level security would refuse it.
    await this.platform.asSystem('jobs.dead_letter', { correlationId: e?.jobId }, async () => {
      await this.db.insert(jobDeadLetters).values({
        jobId: e?.jobId ?? 'unknown',
        queue,
        command: e?.command ?? 'unknown',
        tenantId: e?.tenantId ?? null,
        userId: e?.userId ?? null,
        membershipId: e?.membershipId ?? null,
        payload: (e?.payload ?? data ?? {}) as never,
        error: describeFailure(error),
        attempts,
      });
    });
  }
}
