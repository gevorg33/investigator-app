import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testPool } from '../../../test/db';
import { TEST_REDIS_URL, testQueuePrefix } from '../../../test/redis';
import { scopedDb } from '../../../test/workspace-context';
import * as schema from '../../database/schema';
import { jobDeadLetters } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { PlatformContext } from '../context/platform-context';
import { DeadLetters, describeFailure } from './dead-letters';
import { PermanentJobError, type JobEnvelope, type JobHandler } from './job';
import { DELIVERY, JobQueue, JobWorkers, processorFor } from './job-queue';
import type { JobRunner } from './job-runner';

/**
 * The queue (T-082): BullMQ on Redis carries envelopes; a failure retrying cannot fix, or the last
 * attempt of one it could, ends in the dead letters with the context the job was queued in.
 */
describe('the job queue', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let deadLetters: DeadLetters;
  const open: Array<{ close(): Promise<void> }> = [];

  beforeAll(() => {
    sql = testPool();
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const db = scopedDb(sql);
    deadLetters = new DeadLetters(db, new PlatformContext(new AuditService(db)));
  });

  afterEach(async () => {
    await Promise.all(open.splice(0).map((o) => o.close()));
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  const envelope = (over: Partial<JobEnvelope> = {}): JobEnvelope => ({
    jobId: `probe-${randomUUID()}`,
    key: randomUUID(),
    command: 'probe',
    tenantId: randomUUID(),
    userId: randomUUID(),
    membershipId: randomUUID(),
    payload: { n: 1 },
    ...over,
  });
  const lettersFor = (jobId: string) =>
    ownerDb.select().from(jobDeadLetters).where(eq(jobDeadLetters.jobId, jobId));

  /** A queue and its workers under a prefix of their own, with a runner the test controls. */
  const stack = (run: (data: unknown) => Promise<unknown>) => {
    const config = { redisUrl: TEST_REDIS_URL, prefix: testQueuePrefix() };
    const handler = { command: 'probe', queue: 'events' } as JobHandler;
    const queue = new JobQueue(config);
    const workers = new JobWorkers(config, { run } as unknown as JobRunner, deadLetters, [handler]);
    open.push(workers, queue);
    return { queue, workers };
  };

  it('delivers an envelope to a worker exactly as it was queued', async () => {
    const received: unknown[] = [];
    const job = envelope();
    const done = new Promise<void>((resolve) => {
      const { queue, workers } = stack(async (data) => {
        received.push(data);
        resolve();
      });
      void workers
        .start(() => undefined)
        .then((queues) => {
          expect(queues).toEqual(['events']);
          void queue.enqueue('events', job);
        });
    });
    await done;
    expect(received).toEqual([job]);
  });

  it('is one job however many times the same work is queued while the first is known', async () => {
    const run = vi.fn(async () => 'done');
    const { queue } = stack(run);
    const job = envelope();
    await queue.enqueue('events', job);
    await queue.enqueue('events', { ...job, payload: { n: 2 } });
    const redis = (
      queue as unknown as { queue(n: string): { getJobCounts(): Promise<Record<string, number>> } }
    ).queue('events');
    expect((await redis.getJobCounts()).waiting).toBe(1);
  });

  it('starts no worker for a queue no handler uses', async () => {
    const config = { redisUrl: TEST_REDIS_URL, prefix: testQueuePrefix() };
    const workers = new JobWorkers(config, {} as JobRunner, deadLetters, []);
    open.push(workers);
    expect(await workers.start(() => undefined)).toEqual([]);
  });

  it('says what went wrong in a worker rather than letting it take the process down', async () => {
    const lines: string[] = [];
    const { workers } = stack(async () => 'done');
    await workers.start((l) => lines.push(l));
    const [worker] = (workers as unknown as { workers: Array<{ emit(e: string, x: Error): void }> })
      .workers;
    worker!.emit('error', new Error('Connection lost'));
    expect(lines).toEqual(['worker: events: Error: Connection lost']);
  });

  it('closes cleanly, even with nothing opened', async () => {
    const queue = new JobQueue({ redisUrl: TEST_REDIS_URL, prefix: testQueuePrefix() });
    await expect(queue.close()).resolves.toBeUndefined();
  });

  it('delivers five times, backing off with jitter, then stops', () => {
    expect(DELIVERY).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
    });
  });

  describe('a failure', () => {
    const jobOf = (data: JobEnvelope, attemptsMade: number) =>
      ({ data, attemptsMade, opts: { attempts: 5 } }) as unknown as Job<unknown>;

    it('retrying cannot fix goes straight to the dead letters, context and all, and stops', async () => {
      const data = envelope();
      const process = processorFor(
        {
          run: async () => Promise.reject(new PermanentJobError('context_refused')),
        } as unknown as JobRunner,
        deadLetters,
        'events',
      );
      await expect(process(jobOf(data, 0))).rejects.toBeInstanceOf(UnrecoverableError);
      expect(await lettersFor(data.jobId)).toMatchObject([
        {
          queue: 'events',
          command: 'probe',
          tenantId: data.tenantId,
          userId: data.userId,
          membershipId: data.membershipId,
          payload: { n: 1 },
          error: 'context_refused',
          attempts: 1,
        },
      ]);
    });

    it('it could is thrown back for another attempt, and kept only after the last', async () => {
      const data = envelope();
      const process = processorFor(
        { run: async () => Promise.reject(new Error('lock timeout')) } as unknown as JobRunner,
        deadLetters,
        'events',
      );
      await expect(process(jobOf(data, 0))).rejects.toThrow('lock timeout');
      await expect(process(jobOf(data, 3))).rejects.not.toBeInstanceOf(UnrecoverableError);
      expect(await lettersFor(data.jobId)).toEqual([]);
      await expect(process(jobOf(data, 4))).rejects.toBeInstanceOf(UnrecoverableError);
      expect(await lettersFor(data.jobId)).toMatchObject([
        { error: 'Error: lock timeout', attempts: 5 },
      ]);
    });

    it('counts a job with no attempts set as having had its one', async () => {
      const data = envelope();
      const process = processorFor(
        { run: async () => Promise.reject('not even an Error') } as unknown as JobRunner,
        deadLetters,
        'events',
      );
      const job = { data, attemptsMade: 0, opts: {} } as unknown as Job<unknown>;
      await expect(process(job)).rejects.toThrow('not even an Error');
      expect(await lettersFor(data.jobId)).toMatchObject([
        { error: 'not even an Error', attempts: 1 },
      ]);
    });

    it('keeps even what was not an envelope, as it arrived', async () => {
      const marker = `garbage-${randomUUID()}`;
      await deadLetters.record({ marker }, 'events', new PermanentJobError('invalid_envelope'), 1);
      const [row] = await ownerSql<{ job_id: string; command: string; tenant_id: string | null }[]>`
        SELECT job_id, command, tenant_id FROM job_dead_letters WHERE payload->>'marker' = ${marker}`;
      expect(row).toEqual({ job_id: 'unknown', command: 'unknown', tenant_id: null });
      await deadLetters.record(undefined, 'events', 'no data at all', 1);
    });
  });

  it('describes a failure in its own words, bounded', () => {
    expect(describeFailure(new PermanentJobError('unknown_command'))).toBe('unknown_command');
    expect(describeFailure(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
    expect(describeFailure('plain')).toBe('plain');
    expect(describeFailure(new Error('y'.repeat(900)))).toHaveLength(500);
  });
});

describe('the Redis connection settings', () => {
  it('read host, port, credentials, database and TLS from the URL, and never give up blocking', async () => {
    const { connectionFor } = await import('./job-queue');
    expect(connectionFor('redis://localhost:6380')).toEqual({
      host: 'localhost',
      port: 6380,
      maxRetriesPerRequest: null,
    });
    expect(connectionFor('rediss://jobs:p%40ss@cache.example:6390/2')).toEqual({
      host: 'cache.example',
      port: 6390,
      username: 'jobs',
      password: 'p@ss',
      db: 2,
      tls: {},
      maxRetriesPerRequest: null,
    });
    expect(connectionFor('redis://cache.example')).toMatchObject({ port: 6379 });
  });
});
