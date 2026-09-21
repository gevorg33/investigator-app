import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle as drizzleClient, type drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { testContext } from '../../../test/context';
import { testPool } from '../../../test/db';
import { scopedDb } from '../../../test/workspace-context';
import * as schema from '../../database/schema';
import { auditLogs } from '../../database/schema';
import { databaseSettings } from '../../database/scoped-client';
import { AuditService } from '../audit/audit.service';
import { runInContext } from './execution-context';
import { currentPlatformAccess, PlatformContext } from './platform-context';

/**
 * Who may cross workspaces, what the database is told when they do, and what the audit log keeps
 * of it (T-077, T-079).
 *
 * The entry check is deliberately a second one: the services here have already asked
 * `AuthzService` and audited a refusal. This one exists so that a path which forgets to ask
 * cannot widen what the database shows.
 */
describe('platform access', () => {
  let app: postgres.Sql;
  let ownerSql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let platform: PlatformContext;

  const reviewer = testActor({
    userId: '00000000-0000-4000-8000-0000000000aa',
    roles: ['STAFF'],
    staffScopes: ['VERIFICATION'],
  });

  const req = () => ({ ip: '198.51.100.90', userAgent: 'vitest', correlationId: randomUUID() });

  // As the owner: these rows belong to no workspace (the spec enters from none), and the
  // application sees only its own workspace's (T-080).
  const entries = (correlationId: string) =>
    ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId));

  beforeAll(() => {
    app = testPool({ max: 2 });
    db = scopedDb(app);
    ownerSql = testPool({ max: 1, role: 'owner' });
    ownerDb = drizzleClient(ownerSql, { schema });
    platform = new PlatformContext(new AuditService(db));
  });

  afterAll(async () => {
    await app.end();
    await ownerSql.end();
  });

  it('is absent until it is entered', () => {
    expect(currentPlatformAccess()).toBeUndefined();
    expect(databaseSettings()).toBeUndefined();
  });

  describe('a staff member with the scope', () => {
    it('gets in, and the database is told', async () => {
      const r = req();
      const seen = await platform.asStaff(
        reviewer,
        { scope: 'VERIFICATION', purpose: 'verification.review' },
        r,
        () => Promise.resolve({ access: currentPlatformAccess(), settings: databaseSettings() }),
      );
      expect(seen.access).toEqual({
        scope: 'VERIFICATION',
        purpose: 'verification.review',
        reason: null,
        actorId: reviewer.userId,
      });
      expect(seen.settings).toMatchObject({ platformAccess: 'on', userId: '' });
      expect(currentPlatformAccess()).toBeUndefined();
    });

    it('leaves one audit row per crossing: who, which scope, what for', async () => {
      const r = req();
      await platform.asStaff(
        reviewer,
        { scope: 'VERIFICATION', purpose: 'verification.queue' },
        r,
        () => Promise.resolve('read the queue'),
      );
      const [row] = await entries(r.correlationId!);
      expect(row).toMatchObject({
        actorId: reviewer.userId,
        actorRole: 'STAFF',
        staffScope: 'VERIFICATION',
        action: 'platform.access',
        resourceType: 'workspace',
        resourceId: 'verification.queue',
        reason: null,
        ipAddress: r.ip,
      });
    });

    it('records the crossing even when the work then fails', async () => {
      // The row goes in before `fn` runs, through its own statement — a crossing that happened
      // is recorded whether or not what followed survived.
      const r = req();
      await expect(
        platform.asStaff(
          reviewer,
          { scope: 'VERIFICATION', purpose: 'verification.decide' },
          r,
          () => Promise.reject(new Error('the decision failed')),
        ),
      ).rejects.toThrow('the decision failed');
      expect(await entries(r.correlationId!)).toHaveLength(1);
    });

    it('keeps the workspace the request is in, and adds access to it', async () => {
      const context = testContext({ userId: reviewer.userId });
      const settings = await runInContext(context, () =>
        platform.asStaff(
          reviewer,
          { scope: 'VERIFICATION', purpose: 'verification.review' },
          req(),
          () => Promise.resolve(databaseSettings()),
        ),
      );
      expect(settings).toEqual({
        tenantId: context.tenantId,
        userId: reviewer.userId,
        membershipId: context.membershipId,
        sessionId: context.sessionId,
        platformAccess: 'on',
      });
    });
  });

  describe('everyone else', () => {
    it.each([
      ['is not staff at all', testActor({ userId: 'c-1', roles: ['CUSTOMER'] })],
      [
        'holds another scope',
        testActor({ userId: 's-2', roles: ['STAFF'], staffScopes: ['SUPPORT'] }),
      ],
      [
        'is staff but working as an investigator right now',
        testActor({
          userId: 's-3',
          roles: ['STAFF', 'INVESTIGATOR'],
          staffScopes: ['VERIFICATION'],
          activeRole: 'INVESTIGATOR',
        }),
      ],
    ])('is refused when they %s', async (_label, actor) => {
      const r = req();
      await expect(
        platform.asStaff(actor, { scope: 'VERIFICATION', purpose: 'verification.review' }, r, () =>
          Promise.resolve('reached'),
        ),
      ).rejects.toMatchObject({ status: 403 });
      // Refused before entering, so there is no crossing to record: AuthzService audited the
      // denial the caller's own check produced.
      expect(await entries(r.correlationId!)).toEqual([]);
    });
  });

  describe('access no route defines', () => {
    it('is recorded with the reason the person typed', async () => {
      const r = req();
      const reason = 'Customer 4821 asked why their mission was rejected.';
      await platform.asStaff(
        reviewer,
        { scope: 'VERIFICATION', purpose: 'support.lookup', reason },
        r,
        () => Promise.resolve('looked'),
      );
      const [row] = await entries(r.correlationId!);
      expect(row).toMatchObject({ resourceId: 'support.lookup', reason });
    });

    it('refuses a reason too short to mean anything', async () => {
      const r = req();
      await expect(
        platform.asStaff(
          reviewer,
          { scope: 'VERIFICATION', purpose: 'support.lookup', reason: 'asked' },
          r,
          () => Promise.resolve('looked'),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await entries(r.correlationId!)).toEqual([]);
    });

    it('refuses whitespace dressed up as a reason', async () => {
      await expect(
        platform.asStaff(
          reviewer,
          { scope: 'VERIFICATION', purpose: 'support.lookup', reason: '               ' },
          req(),
          () => Promise.resolve('looked'),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('the system', () => {
    it('runs with no user and no workspace, and is audited as itself', async () => {
      const r = req();
      const seen = await platform.asSystem('assignment.create_from_payment', r, () =>
        Promise.resolve({ access: currentPlatformAccess(), settings: databaseSettings() }),
      );
      expect(seen.access).toEqual({
        scope: 'SYSTEM',
        purpose: 'assignment.create_from_payment',
        reason: null,
        actorId: null,
      });
      expect(seen.settings).toEqual({
        tenantId: '',
        userId: '',
        membershipId: '',
        sessionId: '',
        platformAccess: 'on',
      });
      const [row] = await entries(r.correlationId!);
      expect(row).toMatchObject({
        actorId: null,
        actorRole: 'SYSTEM',
        staffScope: 'SYSTEM',
        resourceId: 'assignment.create_from_payment',
      });
    });
  });

  it('hands out a frozen record, so nothing downstream can rewrite why it is here', async () => {
    await platform.asSystem('assignment.create_from_payment', req(), async () => {
      const access = currentPlatformAccess()!;
      expect(Object.isFrozen(access)).toBe(true);
      expect(() => Object.assign(access, { reason: 'something else' })).toThrow();
    });
  });
});
