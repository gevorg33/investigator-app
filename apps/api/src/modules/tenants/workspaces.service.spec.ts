import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import { runInContext } from '../../common/context/execution-context';
import { WorkspaceResolver } from '../../common/context/workspace.resolver';
import * as schema from '../../database/schema';
import { auditLogs, userSessions } from '../../database/schema';
import { WorkspacesService } from './workspaces.service';

describe('workspaces', () => {
  let app: postgres.Sql;
  let owner: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  // Audit rows read as the owner (T-080): the application sees only its own workspace's.
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: WorkspacesService;
  let resolver: WorkspaceResolver;
  const req = () => ({ correlationId: randomUUID(), ip: '198.51.100.40' });

  beforeAll(() => {
    app = testPool();
    owner = testPool({ role: 'owner' });
    db = scopedDb(app);
    ownerDb = drizzle(owner, { schema });
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    resolver = new WorkspaceResolver(db, authz);
    service = new WorkspacesService(db, authz, audit, resolver);
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  it('lists Personal first, then agencies, with the caller’s roles, marking the current one', async () => {
    const me = await member(owner);
    const boss = await member(owner);
    const mine = await agency(owner, [{ userId: me.actor.userId }]);
    const theirs = await agency(owner, [
      { userId: boss.actor.userId },
      { userId: me.actor.userId, role: 'MANAGER' },
    ]);

    const ctx = await resolver.resolve(me.actor, theirs.tenantId);
    const list = await runInContext(ctx, () => service.list(me.actor, req()));

    expect(list[0]).toMatchObject({
      id: me.personalId,
      kind: 'PERSONAL',
      name: null,
      roles: ['OWNER'],
      current: false,
    });
    expect(
      list
        .slice(1)
        .map((w) => w.id)
        .sort(),
    ).toEqual([mine.tenantId, theirs.tenantId].sort());
    expect(list.find((w) => w.id === theirs.tenantId)).toMatchObject({
      roles: ['MANAGER'],
      current: true,
    });
  });

  it('leaves out workspaces the caller has left or that are stopped', async () => {
    const me = await member(owner);
    const boss = await member(owner);
    const left = await agency(owner, [{ userId: boss.actor.userId }, { userId: me.actor.userId }]);
    const stopped = await agency(owner, [{ userId: me.actor.userId }]);
    await owner`UPDATE tenant_memberships SET status = 'REMOVED' WHERE id = ${left.memberships[1]!}`;
    await owner`UPDATE tenants SET status = 'SUSPENDED' WHERE id = ${stopped.tenantId}`;
    const list = await inWorkspaceOf(owner, me.actor.userId, () => service.list(me.actor, req()));
    expect(list.map((w) => w.id)).toEqual([me.personalId]);
  });

  it('activates a workspace as the session default, audited', async () => {
    const me = await member(owner);
    const { tenantId } = await agency(owner, [{ userId: me.actor.userId }]);
    const r = req();
    await expect(
      inWorkspaceOf(owner, me.actor.userId, () => service.activate(me.actor, tenantId, r)),
    ).resolves.toEqual({ id: tenantId });
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, me.actor.sessionId));
    expect(session?.defaultTenantId).toBe(tenantId);
    const [row] = await ownerDb
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.correlationId, r.correlationId),
          eq(auditLogs.action, 'workspace.activated'),
        ),
      );
    expect(row).toMatchObject({ actorId: me.actor.userId, resourceId: tenantId });
  });

  it('refuses to activate a workspace the caller is not in, and changes nothing', async () => {
    const me = await member(owner);
    const other = await member(owner);
    await expect(
      inWorkspaceOf(owner, me.actor.userId, () =>
        service.activate(me.actor, other.personalId, req()),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, me.actor.sessionId));
    expect(session?.defaultTenantId).toBeNull();
  });

  it('refuses a suspended account', async () => {
    const me = await member(owner);
    await expect(
      inWorkspaceOf(owner, me.actor.userId, () =>
        service.list({ ...me.actor, status: 'SUSPENDED' }, req()),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
