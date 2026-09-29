import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type Tx } from '../../database/database.module';
import { jobRuns } from '../../database/schema';
import { runInContext } from '../context/execution-context';
import { PlatformContext } from '../context/platform-context';
import { WorkspaceResolver } from '../context/workspace.resolver';
import {
  isEnvelope,
  JOB_HANDLERS,
  PermanentJobError,
  type JobEnvelope,
  type JobHandler,
} from './job';

export type JobOutcome = 'done' | 'duplicate';

/**
 * Runs one job where it belongs (T-082, tenancy.md §9):
 *
 * 1. re-reads the context it was queued in — account, membership, workspace — and refuses the job
 *    if any has gone: a removed member's work does not run on their old authority;
 * 2. restores that context, so the scoped database path and row-level security apply exactly as
 *    they do over HTTP (a system job runs in the audited system context instead);
 * 3. opens one transaction, claims the job's key in `job_runs` and runs the handler in it — the
 *    effect and the record that it happened commit together, so a retry or a duplicate delivery
 *    finds the claim and does nothing.
 *
 * `this.db` is only ever reached inside a restored context or the system context:
 * `jobs.static.spec.ts` holds that for every file in this directory.
 */
@Injectable()
export class JobRunner {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly resolver: WorkspaceResolver,
    private readonly platform: PlatformContext,
    @Inject(JOB_HANDLERS) private readonly handlers: readonly JobHandler[],
  ) {}

  async run(data: unknown): Promise<JobOutcome> {
    if (!isEnvelope(data)) throw new PermanentJobError('invalid_envelope');
    const handler = this.handlers.find((h) => h.command === data.command);
    if (handler === undefined) throw new PermanentJobError('unknown_command');
    let payload: unknown;
    try {
      payload = handler.parse(data.payload);
    } catch {
      throw new PermanentJobError('invalid_payload');
    }
    const envelope = { ...data, payload };

    if (envelope.tenantId === null) {
      return this.platform.asSystem('jobs.run_system', { correlationId: envelope.jobId }, () =>
        this.db.transaction((tx) => this.claimAndRun(tx, handler, envelope)),
      );
    }
    const context = await this.resolver.forJob({
      tenantId: envelope.tenantId,
      userId: envelope.userId!,
      membershipId: envelope.membershipId!,
    });
    if (context === undefined) throw new PermanentJobError('context_refused');
    return runInContext(context, () =>
      this.db.transaction((tx) => this.claimAndRun(tx, handler, envelope)),
    );
  }

  private async claimAndRun(
    tx: Tx,
    handler: JobHandler,
    envelope: JobEnvelope,
  ): Promise<JobOutcome> {
    // The claim is the constraint's: two deliveries racing both try, and one finds it taken. Its
    // workspace is the context's, by default — never the envelope's say-so.
    const [claimed] = await tx
      .insert(jobRuns)
      .values({ jobKey: envelope.key, command: envelope.command })
      .onConflictDoNothing()
      .returning({ id: jobRuns.id });
    if (claimed === undefined) return 'duplicate';
    await handler.run(envelope.payload, tx, envelope);
    return 'done';
  }
}
