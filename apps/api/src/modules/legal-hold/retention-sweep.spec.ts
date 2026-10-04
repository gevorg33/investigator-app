import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import type { TestDb } from '../../../test/mission-fixtures';
import { TEST_REDIS_URL, testQueuePrefix } from '../../../test/redis';
import { scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import { PlatformContext } from '../../common/context/platform-context';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import { PermanentJobError, scheduledRun, systemEnvelope } from '../../common/jobs/job';
import { connectionFor, JobQueue, JobWorkers } from '../../common/jobs/job-queue';
import type { JobRunner } from '../../common/jobs/job-runner';
import { JobRunner as Runner } from '../../common/jobs/job-runner';
import type { DeadLetters } from '../../common/jobs/dead-letters';
import * as schema from '../../database/schema';
import { auditLogs, jobRuns, oauthAttempts } from '../../database/schema';
import { RetentionGuard } from './retention-guard';
import { RETENTION_RULE_NAMES, RETENTION_RULES, sweepOf } from './retention-rules';
import { RETENTION_SWEEP, RetentionSchedule, RetentionSweepHandler } from './retention-sweep';

/**
 * Retention on a schedule (T-204): a sweep is a system job the runner runs like any other — one
 * audited crossing per run, the sweep in the run's transaction — and each rule is a BullMQ
 * scheduler the worker installs, so every interval queues exactly one run with a key of its own.
 */
describe('retention on a schedule (T-204)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: TestDb;
  let runner: Runner;
  let handler: RetentionSweepHandler;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    handler = new RetentionSweepHandler(new RetentionGuard(audit));
    runner = new Runner(
      db,
      new WorkspaceResolver(db, new AuthzService(audit)),
      new PlatformContext(audit),
      [handler],
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const DAY = 86_400_000;
  const attempt = (over: Partial<typeof oauthAttempts.$inferInsert> = {}) =>
    ownerDb
      .insert(oauthAttempts)
      .values({
        provider: 'GOOGLE',
        intent: 'SIGN_IN',
        stateHash: `s-${randomUUID()}`,
        nonceHash: 'n',
        expiresAt: new Date(Date.now() - 2 * DAY),
        ...over,
      })
      .returning()
      .then((rows) => rows[0]!);
  /** A first sign-in that went on to wait for its documents carries all three. */
  const signup = () => ({
    signupTokenHash: `t-${randomUUID()}`,
    providerAccountId: `sub-${randomUUID()}`,
  });
  const left = async (ids: string[]) =>
    (
      await ownerDb
        .select({ id: oauthAttempts.id })
        .from(oauthAttempts)
        .where(inArray(oauthAttempts.id, ids))
    )
      .map((r) => r.id)
      .sort();
  /** One run, as a scheduler would queue it. */
  const run = (rule = 'retention.oauth_attempts', at = Date.now()) =>
    runner.run(
      scheduledRun(systemEnvelope(RETENTION_SWEEP, rule, { rule }), `repeat:${rule}:${at}`),
    );

  describe('the oauth attempts rule', () => {
    it('removes attempts a day past their lapse, keeps a held account’s, and leaves the rest', async () => {
      const lapsed = await attempt();
      const recent = await attempt({ expiresAt: new Date(Date.now() - 2 * 60_000) });
      // A first sign-in still waiting for its documents is not lapsed until the sign-up is.
      const waiting = await attempt({
        signupExpiresAt: new Date(Date.now() + 10 * 60_000),
        ...signup(),
      });
      const signupLapsed = await attempt({
        signupExpiresAt: new Date(Date.now() - 2 * DAY),
        ...signup(),
      });
      const heldUser = (await person(ownerDb)).userId;
      const held = await attempt({ intent: 'LINK', userId: heldUser });
      const [hold] = await owner<{ id: string }[]>`
        INSERT INTO legal_holds (resource_type, resource_id, reason, placed_by)
        VALUES ('USER', ${heldUser}, 'Preservation request for this account.', ${randomUUID()})
        RETURNING id`;

      const at = Date.now();
      expect(await run('retention.oauth_attempts', at)).toBe('done');
      expect(await left([lapsed.id, recent.id, waiting.id, signupLapsed.id, held.id])).toEqual(
        [recent.id, waiting.id, held.id].sort(),
      );

      // One crossing — the runner's — and the sweep's report, all under the run's id.
      const runId = `repeat:retention.oauth_attempts:${at}`;
      const trail = await ownerDb
        .select({
          action: auditLogs.action,
          resourceId: auditLogs.resourceId,
          reason: auditLogs.reason,
        })
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, runId));
      expect(trail).toEqual(
        expect.arrayContaining([
          { action: 'platform.access', resourceId: 'jobs.run_system', reason: null },
          {
            action: 'retention.kept',
            resourceId: hold!.id,
            reason: 'retention.oauth_attempts: 1 due for deletion, kept under this hold',
          },
          {
            action: 'retention.deleted',
            resourceId: 'retention.oauth_attempts',
            reason: '2 deleted',
          },
        ]),
      );
      expect(trail.filter((a) => a.action === 'platform.access')).toHaveLength(1);
      // And the run is recorded, under its own key.
      expect(await ownerDb.select().from(jobRuns).where(eq(jobRuns.jobKey, runId))).toHaveLength(1);
    });

    it('runs every scheduled run, and only once for a redelivery of the same run', async () => {
      const first = await attempt();
      expect(await run('retention.oauth_attempts', 1)).toBe('done');
      expect(await left([first.id])).toEqual([]);

      const second = await attempt();
      // The same run delivered again finds its claim: nothing happens.
      expect(await run('retention.oauth_attempts', 1)).toBe('duplicate');
      expect(await left([second.id])).toEqual([second.id]);
      // The next run is a run of its own.
      expect(await run('retention.oauth_attempts', 2)).toBe('done');
      expect(await left([second.id])).toEqual([]);
    });

    it('takes its period from the rule', () => {
      expect(RETENTION_RULES['retention.oauth_attempts'].periodDays).toBe(1);
      expect(sweepOf('retention.oauth_attempts')).toMatchObject({
        rule: 'retention.oauth_attempts',
        table: oauthAttempts,
      });
    });
  });

  it('refuses a rule the code does not have, for good', async () => {
    await expect(run('retention.everything')).rejects.toBeInstanceOf(PermanentJobError);
    expect(() => handler.parse(null)).toThrow('not a retention rule');
  });

  describe('the schedule', () => {
    const open: Array<{ close(): Promise<void> }> = [];
    afterEach(async () => {
      await Promise.all(open.splice(0).map((o) => o.close()));
    });
    const setup = () => {
      const config = { redisUrl: TEST_REDIS_URL, prefix: testQueuePrefix() };
      const jobs = new JobQueue(config);
      const raw = new Queue('maintenance', {
        connection: connectionFor(config.redisUrl),
        prefix: config.prefix,
      });
      open.push(jobs, raw);
      return { config, jobs, raw };
    };

    it('puts every rule on its schedule, removes a retired rule’s, and leaves other schedules alone', async () => {
      const { jobs, raw } = setup();
      await raw.upsertJobScheduler('retention.retired_rule', { every: 60_000 });
      await raw.upsertJobScheduler('maintenance.other', { every: 60_000 });

      const installed = await new RetentionSchedule(jobs).install();
      expect(installed).toEqual({
        scheduled: RETENTION_RULE_NAMES,
        removed: ['retention.retired_rule'],
      });
      const schedulers = (await raw.getJobSchedulers()).map((s) => [s.key, s.every]).sort();
      expect(schedulers).toEqual(
        [
          ['maintenance.other', 60_000],
          ...RETENTION_RULE_NAMES.map((r) => [r, RETENTION_RULES[r].everyMs]),
        ].sort(),
      );
      expect((await raw.getJobScheduler('retention.oauth_attempts'))?.template?.data).toMatchObject(
        { command: RETENTION_SWEEP, payload: { rule: 'retention.oauth_attempts' } },
      );

      // Installing again — another worker starting — changes nothing.
      expect(await new RetentionSchedule(jobs).install()).toEqual({
        scheduled: RETENTION_RULE_NAMES,
        removed: [],
      });
      expect(await raw.getJobSchedulersCount()).toBe(RETENTION_RULE_NAMES.length + 1);
    });

    it('hands the worker each run keyed by itself', async () => {
      const { config, jobs } = setup();
      const received: unknown[] = [];
      const two = new Promise<void>((resolve) => {
        const workers = new JobWorkers(
          config,
          {
            run: async (data: unknown) => {
              received.push(data);
              if (received.length === 2) resolve();
            },
          } as unknown as JobRunner,
          {} as DeadLetters,
          [handler],
        );
        open.push(workers);
        void workers
          .start(() => undefined)
          .then(() =>
            jobs.schedule(
              'maintenance',
              'retention.probe',
              50,
              systemEnvelope(RETENTION_SWEEP, 'retention.probe', { rule: 'retention.probe' }),
            ),
          );
      });
      await two;
      const runs = received.slice(0, 2) as Array<{ jobId: string; key: string }>;
      for (const r of runs) {
        expect(r.jobId).toMatch(/^repeat:retention\.probe:\d+$/);
        expect(r.key).toBe(r.jobId);
      }
      expect(runs[0]!.key).not.toBe(runs[1]!.key);
    });
  });
});
