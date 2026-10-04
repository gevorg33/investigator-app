import { Inject, Injectable } from '@nestjs/common';
import { Queue, UnrecoverableError, Worker, type Job, type JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { DeadLetters } from './dead-letters';
import {
  JOB_HANDLERS,
  PermanentJobError,
  QUEUES,
  scheduledRun,
  type JobEnvelope,
  type JobHandler,
  type QueueName,
} from './job';
import { JobRunner } from './job-runner';

/** Where the queues live. `prefix` keeps one deployment's — or one test run's — keys apart. */
export interface JobQueueConfig {
  readonly redisUrl: string;
  readonly prefix: string;
}
export const JOB_QUEUE_CONFIG = Symbol('JOB_QUEUE_CONFIG');

/**
 * Every job's delivery terms: five attempts, exponential backoff from two seconds with jitter — so
 * retries after one outage do not all land together — then the dead letters. Completed and failed
 * jobs are trimmed from Redis; what matters about them is in PostgreSQL (`job_runs`, dead letters).
 */
export const DELIVERY: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
  removeOnComplete: { count: 1_000 },
  removeOnFail: { count: 1_000 },
};

/**
 * Connection settings from `REDIS_URL`, for BullMQ to open — and close — connections of its own.
 * Handing it a shared connection instead left commands in flight when the process quit it.
 * `maxRetriesPerRequest: null`: a worker blocks on Redis, and must not give up after a few retries.
 */
export function connectionFor(url: string): RedisOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port === '' ? 6379 : Number(u.port),
    ...(u.username !== '' && { username: decodeURIComponent(u.username) }),
    ...(u.password !== '' && { password: decodeURIComponent(u.password) }),
    ...(u.pathname.length > 1 && { db: Number(u.pathname.slice(1)) }),
    ...(u.protocol === 'rediss:' && { tls: {} }),
    maxRetriesPerRequest: null,
  };
}

/**
 * Putting jobs on a queue (T-082). The job's own id is BullMQ's id, so the same work enqueued twice
 * — a dispatcher retrying after a crash — is one job while the first is still known to Redis, and
 * found already done in `job_runs` after it is not.
 */
@Injectable()
export class JobQueue {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(JOB_QUEUE_CONFIG) private readonly config: JobQueueConfig) {}

  async enqueue(queue: QueueName, envelope: JobEnvelope): Promise<void> {
    await this.queue(queue).add(envelope.command, envelope, { ...DELIVERY, jobId: envelope.jobId });
  }

  /**
   * Runs `envelope` every `everyMs` (T-204), as a BullMQ job scheduler named `id`. The schedule
   * lives in Redis, so however many workers install it, each interval queues one job. Installing it
   * again with another interval replaces it.
   */
  async schedule(
    queue: QueueName,
    id: string,
    everyMs: number,
    envelope: JobEnvelope,
  ): Promise<void> {
    // No `jobId`: the scheduler names each run itself (`repeat:<id>:<time>`).
    await this.queue(queue).upsertJobScheduler(
      id,
      { every: everyMs },
      { name: envelope.command, data: envelope, opts: DELIVERY },
    );
  }

  /**
   * Removes every scheduler on `queue` whose name starts with `prefix` and is not in `keep`: a
   * schedule taken out of the code stops. The prefix keeps one owner's sweep off another's schedules.
   */
  async unscheduleExcept(
    queue: QueueName,
    prefix: string,
    keep: readonly string[],
  ): Promise<string[]> {
    const q = this.queue(queue);
    const stale = (await q.getJobSchedulers())
      .map((s) => s.key)
      .filter((key) => key.startsWith(prefix) && !keep.includes(key));
    for (const key of stale) await q.removeJobScheduler(key);
    return stale;
  }

  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (queue === undefined) {
      queue = new Queue(name, {
        connection: connectionFor(this.config.redisUrl),
        prefix: this.config.prefix,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }
}

/**
 * What a worker does with one job it took off `queue`: run it; on a failure retrying cannot fix,
 * or on the last attempt it is allowed, keep it in the dead letters and tell BullMQ to stop. Any
 * other failure is thrown back, and BullMQ retries it after its backoff.
 */
export function processorFor(runner: JobRunner, deadLetters: DeadLetters, queue: QueueName) {
  return async (job: Job<unknown>): Promise<void> => {
    // A scheduler's run carries the scheduler's envelope; it is keyed by this run (T-204).
    const data = job.repeatJobKey === undefined ? job.data : scheduledRun(job.data, job.id!);
    try {
      await runner.run(data);
    } catch (error) {
      const attempts = job.attemptsMade + 1;
      const last = attempts >= (job.opts.attempts ?? 1);
      if (!(error instanceof PermanentJobError) && !last) throw error;
      await deadLetters.record(data, queue, error, attempts);
      throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
    }
  };
}

/** The workers for every queue a handler uses (T-082): started by the worker process, not the API. */
@Injectable()
export class JobWorkers {
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(JOB_QUEUE_CONFIG) private readonly config: JobQueueConfig,
    private readonly runner: JobRunner,
    private readonly deadLetters: DeadLetters,
    @Inject(JOB_HANDLERS) private readonly handlers: readonly JobHandler[],
  ) {}

  /**
   * Starts one worker per queue some handler uses, ready — connected to Redis — before it returns
   * the queues it is working. A worker's `error` events (Redis going away, a stalled job) are said
   * on `out`: an emitter with no `error` listener takes the whole process down.
   */
  async start(out: (line: string) => void, concurrency = 4): Promise<QueueName[]> {
    const used = QUEUES.filter((q) => this.handlers.some((h) => h.queue === q));
    for (const name of used) {
      const worker = new Worker(name, processorFor(this.runner, this.deadLetters, name), {
        connection: connectionFor(this.config.redisUrl),
        prefix: this.config.prefix,
        concurrency,
      });
      worker.on('error', (e) => out(`worker: ${name}: ${e.name}: ${e.message}`));
      this.workers.push(worker);
    }
    await Promise.all(this.workers.map((w) => w.waitUntilReady()));
    return used;
  }

  /** Lets jobs in progress finish, then disconnects. */
  async close(): Promise<void> {
    await Promise.all(this.workers.splice(0).map((w) => w.close()));
  }
}
