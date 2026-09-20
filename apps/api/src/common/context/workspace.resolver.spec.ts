import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import * as schema from '../../database/schema';
import { auditLogs, userSessions } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { AuthzService } from '../authz/authz.service';
import { WorkspaceResolver } from './workspace.resolver';

describe('workspace resolution', () => {
  let app: postgres.Sql;
  let owner: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let resolver: WorkspaceResolver;

  beforeAll(() => {
    app = testPool();
    owner = testPool({ role: 'owner' });
    db = scopedDb(app);
    resolver = new WorkspaceResolver(db, new AuthzService(new AuditService(db)));
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  const defaultOf = async (sessionId: string) =>
    (await db.select().from(userSessions).where(eq(userSessions.id, sessionId)))[0]
      ?.defaultTenantId;

  const denialFor = (correlationId: string) =>
    db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.correlationId, correlationId),
          eq(auditLogs.action, 'authz.denied.workspace.use'),
        ),
      );

  describe('a workspace named by X-Workspace', () => {
    it('resolves the caller’s Personal workspace, with every permission its OWNER holds', async () => {
      const { actor, personalId } = await member(owner);
      const ctx = await resolver.resolve(actor, personalId);
      expect(ctx).toMatchObject({
        tenantId: personalId,
        tenantKind: 'PERSONAL',
        userId: actor.userId,
      });
      expect(ctx.permissions).toHaveLength(40);
    });

    it('resolves an agency the caller works in, with that membership’s permissions only', async () => {
      const boss = await member(owner);
      const viewer = await member(owner);
      const { tenantId, memberships } = await agency(owner, [
        { userId: boss.actor.userId },
        { userId: viewer.actor.userId, role: 'VIEWER' },
      ]);
      const ctx = await resolver.resolve(viewer.actor, tenantId);
      expect(ctx).toMatchObject({ tenantId, tenantKind: 'AGENCY', membershipId: memberships[1] });
      expect(ctx.permissions).toEqual([
        'company.read',
        'employees.read',
        'evidence.read',
        'investigations.read',
        'investigators.read',
        'knowledge.read',
        'reports.read',
        'teams.read',
      ]);
    });

    it.each([
      ['someone else’s Personal workspace', 'foreign'],
      ['a workspace that does not exist', 'missing'],
      ['something that is not an id', 'malformed'],
    ])('refuses %s with 403, audited', async (_label, kind) => {
      const { actor } = await member(owner);
      const other = await member(owner);
      const requested =
        kind === 'foreign'
          ? other.personalId
          : kind === 'missing'
            ? randomUUID()
            : 'not-a-workspace';
      const correlationId = randomUUID();
      await expect(resolver.resolve(actor, requested, { correlationId })).rejects.toMatchObject({
        status: 403,
      });
      const [row] = await denialFor(correlationId);
      expect(row).toMatchObject({
        actorId: actor.userId,
        reason: 'workspace_not_available',
        resourceId: kind === 'malformed' ? null : requested,
      });
    });

    it.each([['SUSPENDED'], ['REMOVED']])(
      'refuses a %s member on their very next request',
      async (status) => {
        const boss = await member(owner);
        const worker = await member(owner);
        const { tenantId, memberships } = await agency(owner, [
          { userId: boss.actor.userId },
          { userId: worker.actor.userId },
        ]);
        await expect(resolver.resolve(worker.actor, tenantId)).resolves.toBeDefined();
        await owner`UPDATE tenant_memberships SET status = ${status}::membership_status WHERE id = ${memberships[1]!}`;
        await expect(resolver.resolve(worker.actor, tenantId)).rejects.toMatchObject({
          status: 403,
        });
      },
    );

    it.each([['SUSPENDED'], ['ARCHIVED']])(
      'refuses a %s workspace to everyone in it',
      async (status) => {
        const boss = await member(owner);
        const { tenantId } = await agency(owner, [{ userId: boss.actor.userId }]);
        await owner`UPDATE tenants SET status = ${status}::tenant_status WHERE id = ${tenantId}`;
        await expect(resolver.resolve(boss.actor, tenantId)).rejects.toMatchObject({ status: 403 });
      },
    );

    it('lets the owner into a workspace still being set up', async () => {
      const boss = await member(owner);
      const { tenantId } = await agency(owner, [{ userId: boss.actor.userId }]);
      await owner`UPDATE tenants SET status = 'CREATING' WHERE id = ${tenantId}`;
      await expect(resolver.resolve(boss.actor, tenantId)).resolves.toMatchObject({ tenantId });
    });
  });

  describe('with no header', () => {
    it('uses the session’s default while it is still usable', async () => {
      const boss = await member(owner);
      const { tenantId } = await agency(owner, [{ userId: boss.actor.userId }]);
      await owner`UPDATE user_sessions SET default_tenant_id = ${tenantId} WHERE id = ${boss.actor.sessionId}`;
      await expect(resolver.resolve(boss.actor, undefined)).resolves.toMatchObject({ tenantId });
    });

    it('falls back to Personal when the default is no longer usable, and the default follows', async () => {
      const boss = await member(owner);
      const worker = await member(owner);
      const { tenantId, memberships } = await agency(owner, [
        { userId: boss.actor.userId },
        { userId: worker.actor.userId },
      ]);
      await owner`UPDATE user_sessions SET default_tenant_id = ${tenantId} WHERE id = ${worker.actor.sessionId}`;
      await owner`UPDATE tenant_memberships SET status = 'REMOVED' WHERE id = ${memberships[1]!}`;

      const ctx = await resolver.resolve(worker.actor, '');
      expect(ctx.tenantId).toBe(worker.personalId);
      expect(await defaultOf(worker.actor.sessionId)).toBe(worker.personalId);
    });

    it('starts a session with no default in Personal, and records it', async () => {
      const { actor, personalId } = await member(owner);
      expect(await defaultOf(actor.sessionId)).toBeNull();
      await expect(resolver.resolve(actor, undefined)).resolves.toMatchObject({
        tenantId: personalId,
      });
      expect(await defaultOf(actor.sessionId)).toBe(personalId);
    });
  });
});
