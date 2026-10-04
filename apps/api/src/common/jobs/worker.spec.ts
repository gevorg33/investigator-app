import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { TEST_REDIS_URL, testQueuePrefix } from '../../../test/redis';
import * as schema from '../../database/schema';
import { auditLogs } from '../../database/schema';
import { connectionFor } from './job-queue';
import { runWorker } from './worker';

/**
 * The worker process (T-082): validated as the API is, working the queues, dispatching the outbox
 * in the system context until told to stop — and then letting go of everything it opened.
 */
describe('the worker', () => {
  let ownerSql: postgres.Sql;
  const saved = {
    REDIS_URL: process.env['REDIS_URL'],
    JOB_QUEUE_PREFIX: process.env['JOB_QUEUE_PREFIX'],
  };

  beforeAll(() => {
    ownerSql = testPool({ role: 'owner' });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  afterAll(async () => {
    await ownerSql.end();
  });

  it('refuses to start half-configured, and says why', async () => {
    const lines: string[] = [];
    const code = await runWorker({
      env: {},
      signal: new AbortController().signal,
      out: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(lines[0]).toMatch(
      /^worker: refused — Invalid environment configuration:[\s\S]*DATABASE_URL/,
    );
  });

  it('works the queues and dispatches the outbox until stopped, then exits cleanly', async () => {
    process.env['REDIS_URL'] = TEST_REDIS_URL;
    process.env['JOB_QUEUE_PREFIX'] = testQueuePrefix();
    const lines: string[] = [];
    const stop = new AbortController();
    const started = new Date();
    const running = runWorker({
      // Everything the API needs too; the test process sets the database, and this the rest.
      env: { ...process.env, SESSION_SECRET: 'x'.repeat(32) },
      signal: stop.signal,
      out: (l) => {
        lines.push(l);
        // Stopped as soon as it says it is working: the dispatcher sees the signal on its next turn.
        if (l.startsWith('worker: working')) stop.abort();
      },
    });
    expect(await running).toBe(0);
    expect(lines).toEqual([
      // T-204: every retention rule on its schedule, and the queue its sweeps run on.
      'worker: retention scheduled — retention.oauth_attempts',
      'worker: working events, notifications, maintenance; dispatching the outbox',
      'worker: stopping',
    ]);
    // The dispatcher entered the system context, and said so, once.
    const entered = await drizzle(ownerSql, { schema })
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, 'outbox.dispatch'));
    expect(entered.filter((e) => e.occurredAt >= started)).toHaveLength(1);
  });

  it('takes a retired retention rule off the schedule when it starts, and says so (T-204)', async () => {
    const prefix = testQueuePrefix();
    process.env['REDIS_URL'] = TEST_REDIS_URL;
    process.env['JOB_QUEUE_PREFIX'] = prefix;
    const maintenance = new Queue('maintenance', {
      connection: connectionFor(TEST_REDIS_URL),
      prefix,
    });
    await maintenance.upsertJobScheduler('retention.retired_rule', { every: 60_000 });
    const lines: string[] = [];
    const stop = new AbortController();
    const code = await runWorker({
      env: { ...process.env, SESSION_SECRET: 'x'.repeat(32) },
      signal: stop.signal,
      out: (l) => {
        lines.push(l);
        if (l.startsWith('worker: working')) stop.abort();
      },
    });
    expect(code).toBe(0);
    expect(lines[0]).toBe(
      'worker: retention scheduled — retention.oauth_attempts; removed retention.retired_rule',
    );
    expect((await maintenance.getJobSchedulers()).map((s) => s.key)).toEqual([
      'retention.oauth_attempts',
    ]);
    await maintenance.close();
  });
});
