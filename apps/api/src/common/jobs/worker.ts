import { Module, type DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '../../config/env.schema';
import { DatabaseModule } from '../../database/database.module';
import { AuthzModule } from '../authz/authz.module';
import { DeadLetters } from './dead-letters';
import { JOB_HANDLERS } from './job';
import { JOB_QUEUE_CONFIG, JobQueue, JobWorkers, type JobQueueConfig } from './job-queue';
import { JobRunner } from './job-runner';
import { OutboxDispatcher } from './outbox-dispatcher';
import { EVENT_SUBSCRIBERS, OutboxDeliveryHandler } from './outbox-delivery.handler';

/**
 * The worker process (T-082): the job runner, the dead letters, the queues and the outbox
 * dispatcher, over the application's own database module — so a worker gets the scoped client, and
 * refuses to start as a role row-level security would not apply to, exactly as the API does.
 */
@Module({
  imports: [DatabaseModule, AuthzModule],
  providers: [
    // Each subscriber arrives with the task that needs it (T-036, T-051); there are none yet.
    { provide: EVENT_SUBSCRIBERS, useValue: [] },
    OutboxDeliveryHandler,
    {
      provide: JOB_HANDLERS,
      inject: [OutboxDeliveryHandler],
      useFactory: (delivery: OutboxDeliveryHandler) => [delivery],
    },
    JobRunner,
    DeadLetters,
    JobQueue,
    JobWorkers,
    OutboxDispatcher,
  ],
})
export class WorkerModule {
  /** The worker, configured with what `runWorker` validated — the one reading of the environment. */
  static with(config: JobQueueConfig): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: JOB_QUEUE_CONFIG, useValue: config }],
    };
  }
}

export interface WorkerOptions {
  env: Readonly<Record<string, string | undefined>>;
  /** Aborted to stop: on SIGTERM and SIGINT in real use. */
  signal: AbortSignal;
  out: (line: string) => void;
}

/**
 * `pnpm --filter api worker`: validates the environment as the API does, starts a worker per queue,
 * and runs the outbox dispatcher until `signal` aborts — then lets jobs in progress finish and
 * disconnects. Returns the exit code rather than exiting, so it can be tested.
 */
export async function runWorker(opts: WorkerOptions): Promise<number> {
  let config: JobQueueConfig;
  try {
    const env = validateEnv({ ...opts.env });
    config = { redisUrl: env.REDIS_URL, prefix: env.JOB_QUEUE_PREFIX };
  } catch (e) {
    opts.out(`worker: refused — ${(e as Error).message}`);
    return 1;
  }
  // `abortOnError: false`: Nest would otherwise exit the process on a startup failure, silently.
  const app = await NestFactory.createApplicationContext(WorkerModule.with(config), {
    logger: false,
    abortOnError: false,
  });
  await app.init();
  const workers = app.get(JobWorkers);
  try {
    const queues = await workers.start(opts.out);
    opts.out(`worker: working ${queues.join(', ')}; dispatching the outbox`);
    await app.get(OutboxDispatcher).run(opts.signal);
    opts.out('worker: stopping');
    return 0;
  } finally {
    await workers.close();
    await app.get(JobQueue).close();
    await app.close();
  }
}
