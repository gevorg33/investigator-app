import { randomUUID } from 'node:crypto';
import { eq, sql as raw } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { agencyContext, personalContext, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import * as schema from '../../database/schema';
import { jobRuns } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { AuthzService } from '../authz/authz.service';
import { currentContext, runInContext, type ExecutionContext } from '../context/execution-context';
import { currentPlatformAccess, PlatformContext } from '../context/platform-context';
import { WorkspaceResolver } from '../context/workspace.resolver';
import {
  envelopeFor,
  isEnvelope,
  PermanentJobError,
  type JobEnvelope,
  type JobHandler,
} from './job';
import { JobRunner } from './job-runner';

/**
 * Jobs restore their workspace (T-082): the context a job runs in is the one it was queued in,
 * re-read — so a removed member's job, a suspended workspace's or a suspended account's does not
 * run — and every job is idempotent within its workspace, however often it is delivered.
 */
describe('the job runner', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let runner: JobRunner;
  /** What the probe handler saw, each time it ran. */
  let seen: Array<{ context?: ExecutionContext; system?: string; tenantInDb: string | null }>;
  /** Throws on the next run when set: the effect then must not stick. */
  let failNext: Error | undefined;

  const probe: JobHandler<{ n: number }> = {
    command: 'probe',
    queue: 'events',
    parse: (p) => {
      if (typeof (p as { n?: unknown })?.n !== 'number') throw new Error('no n');
      return p as { n: number };
    },
    run: async (_payload, tx) => {
      const [row] = await tx.execute<{ tenant: string | null }>(
        raw`SELECT app_current_tenant() AS tenant`,
      );
      seen.push({
        ...(currentContext() !== undefined && { context: currentContext()! }),
        ...(currentPlatformAccess() !== undefined && { system: currentPlatformAccess()!.purpose }),
        tenantInDb: row!.tenant,
      });
      if (failNext !== undefined) {
        const e = failNext;
        failNext = undefined;
        throw e;
      }
    },
  };

  beforeAll(() => {
    sql = testPool();
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    runner = new JobRunner(
      db,
      new WorkspaceResolver(db, new AuthzService(audit)),
      new PlatformContext(audit),
      [probe],
    );
    seen = [];
    failNext = undefined;
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  /** A job queued by `context`, the way a producer queues one. */
  const queuedBy = (context: ExecutionContext, key = randomUUID()) =>
    runInContext(context, () => envelopeFor('probe', key, { n: 1 }));

  const personal = async () => {
    const { actor } = await member(ownerSql);
    return personalContext(ownerSql, actor.userId);
  };

  const runsOf = (key: string) => ownerDb.select().from(jobRuns).where(eq(jobRuns.jobKey, key));

  describe('whose work it is', () => {
    it('restores the context it was queued in, with the membership’s permissions read now', async () => {
      const producer = await personal();
      const job = queuedBy(producer);
      expect(job).toMatchObject({
        tenantId: producer.tenantId,
        userId: producer.userId,
        membershipId: producer.membershipId,
      });
      expect(await runner.run(job)).toBe('done');
      expect(seen).toEqual([
        {
          context: {
            tenantId: producer.tenantId,
            tenantKind: 'PERSONAL',
            userId: producer.userId,
            membershipId: producer.membershipId,
            // A job arrives on no session; its audit rows say so (NULL).
            sessionId: '',
            permissions: producer.permissions,
          },
          tenantInDb: producer.tenantId,
        },
      ]);
      expect(await runsOf(job.key)).toMatchObject([
        { tenantId: producer.tenantId, command: 'probe' },
      ]);
    });

    it('runs an agency member’s job in the agency, with what their role grants there today', async () => {
      const [owner, viewer] = [await member(ownerSql), await member(ownerSql)];
      const { tenantId } = await agency(ownerSql, [
        { userId: owner.actor.userId },
        { userId: viewer.actor.userId, role: 'VIEWER' },
      ]);
      const context = await agencyContext(ownerSql, viewer.actor.userId, tenantId);
      const job = queuedBy(context);
      // Promoted after queuing: the job runs with what the membership holds when it runs.
      await ownerSql`
        UPDATE membership_roles SET role_id = (SELECT id FROM roles WHERE key = 'ADMIN' AND tenant_id IS NULL)
         WHERE membership_id = ${context.membershipId}`;
      await runner.run(job);
      expect(seen[0]!.context).toMatchObject({ tenantId, tenantKind: 'AGENCY' });
      expect(seen[0]!.context!.permissions).toContain('company.update');
      expect(context.permissions).not.toContain('company.update');
    });

    it.each([
      [
        'a member since removed',
        (c: ExecutionContext) =>
          ownerSql`UPDATE tenant_memberships SET status = 'REMOVED' WHERE id = ${c.membershipId}`,
      ],
      [
        'a workspace since suspended',
        (c: ExecutionContext) =>
          ownerSql`UPDATE tenants SET status = 'SUSPENDED' WHERE id = ${c.tenantId}`,
      ],
      [
        'an account since suspended',
        (c: ExecutionContext) =>
          ownerSql`UPDATE users SET status = 'SUSPENDED' WHERE id = ${c.userId}`,
      ],
      [
        'an account since deleted',
        (c: ExecutionContext) =>
          ownerSql`UPDATE users SET deleted_at = now() WHERE id = ${c.userId}`,
      ],
    ])('refuses the job of %s, and does nothing', async (_label, change) => {
      const [owner, colleague] = [await member(ownerSql), await member(ownerSql)];
      const { tenantId } = await agency(ownerSql, [
        { userId: owner.actor.userId },
        { userId: colleague.actor.userId, role: 'MANAGER' },
      ]);
      const context = await agencyContext(ownerSql, colleague.actor.userId, tenantId);
      const job = queuedBy(context);
      await change(context);
      await expect(runner.run(job)).rejects.toEqual(new PermanentJobError('context_refused'));
      expect(seen).toEqual([]);
      expect(await runsOf(job.key)).toEqual([]);
    });

    it('refuses a job naming someone else’s membership, or a workspace its user is not in', async () => {
      const [a, b] = [await personal(), await personal()];
      for (const forged of [
        { ...queuedBy(a), membershipId: b.membershipId },
        { ...queuedBy(a), tenantId: b.tenantId },
      ]) {
        await expect(runner.run(forged)).rejects.toMatchObject({ reason: 'context_refused' });
      }
      expect(seen).toEqual([]);
    });

    it('runs a job the system queued in the audited system context, and in no workspace', async () => {
      const job = envelopeFor('probe', randomUUID(), { n: 1 });
      expect(job).toMatchObject({ tenantId: null, userId: null, membershipId: null });
      expect(await runner.run(job)).toBe('done');
      expect(seen).toEqual([{ system: 'jobs.run_system', tenantInDb: null }]);
      expect(await runsOf(job.key)).toMatchObject([{ tenantId: null }]);
    });
  });

  describe('once, however often it arrives', () => {
    it('does the work once, and finds a duplicate already done', async () => {
      const job = queuedBy(await personal());
      expect(await runner.run(job)).toBe('done');
      expect(await runner.run(job)).toBe('duplicate');
      expect(await runner.run({ ...job, jobId: 'a-second-delivery' })).toBe('duplicate');
      expect(seen).toHaveLength(1);
    });

    it('keys it within its workspace: the same key elsewhere is other work', async () => {
      const key = randomUUID();
      await runner.run(queuedBy(await personal(), key));
      expect(await runner.run(queuedBy(await personal(), key))).toBe('done');
      expect(await runsOf(key)).toHaveLength(2);
    });

    it('keys system jobs among themselves too', async () => {
      const job = envelopeFor('probe', randomUUID(), { n: 1 });
      await runner.run(job);
      expect(await runner.run(job)).toBe('duplicate');
    });

    it('leaves no claim behind when the work fails, so the retry does it', async () => {
      const job = queuedBy(await personal());
      failNext = new Error('a timeout');
      await expect(runner.run(job)).rejects.toThrow('a timeout');
      expect(await runsOf(job.key)).toEqual([]);
      expect(await runner.run(job)).toBe('done');
      expect(await runsOf(job.key)).toHaveLength(1);
    });
  });

  describe('what it refuses outright', () => {
    it.each([
      ['something that is not an envelope', 'nope', 'invalid_envelope'],
      ['a command nobody handles', { ...envelopeFor('elsewhere', 'k', {}) }, 'unknown_command'],
      [
        'a payload the command does not take',
        { ...envelopeFor('probe', 'k', { n: 'x' }) },
        'invalid_payload',
      ],
    ])('%s', async (_label, data, reason) => {
      await expect(runner.run(data)).rejects.toEqual(new PermanentJobError(reason));
    });
  });
});

describe('an envelope', () => {
  const good: JobEnvelope = {
    jobId: 'j',
    key: 'k',
    command: 'c',
    tenantId: randomUUID(),
    userId: randomUUID(),
    membershipId: randomUUID(),
    payload: {},
  };

  it('is what it says, whole', () => {
    expect(isEnvelope(good)).toBe(true);
    expect(isEnvelope({ ...good, tenantId: null, userId: null, membershipId: null })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'envelope'],
    ['half a context', { ...good, membershipId: null }],
    ['an id that is not one', { ...good, userId: 'user-1' }],
    [
      'no payload',
      { jobId: 'j', key: 'k', command: 'c', tenantId: null, userId: null, membershipId: null },
    ],
    ['an empty command', { ...good, command: '' }],
    ['a key too long to be one', { ...good, key: 'k'.repeat(201) }],
  ])('is not %s', (_label, value) => {
    expect(isEnvelope(value)).toBe(false);
  });

  it('names its queue id from its command and key unless told', () => {
    expect(envelopeFor('probe', 'k1', {})).toMatchObject({ jobId: 'probe-k1' });
    expect(envelopeFor('probe', 'k1', {}, 'own-id').jobId).toBe('own-id');
  });
});
