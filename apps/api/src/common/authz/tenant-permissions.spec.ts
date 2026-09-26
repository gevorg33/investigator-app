import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle as drizzleClient, type drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { scopedDb } from '../../../test/workspace-context';
import { agency, member } from '../../../test/workspace-fixtures';
import * as schema from '../../database/schema';
import { auditLogs } from '../../database/schema';
import { AuditService } from '../audit/audit.service';
import { runInContext, type ExecutionContext } from '../context/execution-context';
import { WorkspaceResolver } from '../context/workspace.resolver';
import { AuthzService } from './authz.service';
import type { Actor } from './contract';
import { TENANT_PERMISSIONS, type TenantPermission } from './permissions';

/**
 * What each tenant role may do, taken from the catalog rather than from a list written here
 * (T-078, docs/architecture/tenancy.md §3).
 *
 * Every role × permission pair is exercised — 6 × 41 — against a real membership resolved by the
 * real resolver. Sampling would pass a catalog with one grant missing; this does not. The
 * expectation comes from `role_permissions`, so this is a test of the path from membership to
 * decision, and `tenants.spec.ts` is what holds the catalog itself to the document.
 */
describe('tenant permissions', () => {
  let app: postgres.Sql;
  let owner: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let authz: AuthzService;
  let resolver: WorkspaceResolver;

  const ctx = (action: string) => ({
    action,
    resourceType: 'probe',
    correlationId: randomUUID(),
  });

  beforeAll(() => {
    app = testPool();
    owner = testPool({ role: 'owner' });
    db = scopedDb(app);
    ownerDb = drizzleClient(owner, { schema });
    authz = new AuthzService(new AuditService(db));
    resolver = new WorkspaceResolver(db, authz);
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  /** What the catalog says this role holds. */
  const granted = async (role: string): Promise<string[]> =>
    (
      await owner<{ key: string }[]>`
        SELECT rp.permission_key AS key FROM roles r
          JOIN role_permissions rp ON rp.role_id = r.id
         WHERE r.key = ${role} AND r.tenant_id IS NULL
         ORDER BY 1`
    ).map((r) => r.key);

  /** A member of a fresh agency holding exactly `role`, and the context a request would get. */
  const memberWith = async (role: string): Promise<{ actor: Actor; context: ExecutionContext }> => {
    const boss = await member(owner);
    const worker = await member(owner);
    const { tenantId } = await agency(owner, [
      { userId: boss.actor.userId },
      { userId: worker.actor.userId, role },
    ]);
    return { actor: worker.actor, context: await resolver.resolve(worker.actor, tenantId) };
  };

  const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'INVESTIGATOR', 'AGENCY_STAFF', 'VIEWER'];

  describe.each(ROLES)('a member whose role is %s', (role) => {
    it('holds exactly what the catalog grants that role, and requirePermission agrees on all 41', async () => {
      const expected = await granted(role);
      const { actor, context } = await memberWith(role);
      expect(context.permissions).toEqual(expected);

      const wrong: string[] = [];
      for (const permission of TENANT_PERMISSIONS) {
        const allowed = expected.includes(permission);
        const outcome = await runInContext(context, () =>
          authz
            .requirePermission(actor, permission, ctx(`probe.${permission}`))
            .then(() => true)
            .catch(() => false),
        );
        if (outcome !== allowed) wrong.push(`${permission}: ${outcome ? 'allowed' : 'refused'}`);
      }
      expect(wrong).toEqual([]);
    });
  });

  it('is read with the membership on every request, so a role taken away lands on the next one', async () => {
    const boss = await member(owner);
    const worker = await member(owner);
    const { tenantId, memberships } = await agency(owner, [
      { userId: boss.actor.userId },
      { userId: worker.actor.userId, role: 'MANAGER' },
    ]);
    const before = await resolver.resolve(worker.actor, tenantId);
    expect(before.permissions).toContain('investigations.create');

    // The same edit an owner would make: the role assignment goes, nothing is invalidated.
    await owner`DELETE FROM membership_roles WHERE membership_id = ${memberships[1]!}`;

    const after = await resolver.resolve(worker.actor, tenantId);
    expect(after.permissions).toEqual([]);
    await expect(
      runInContext(after, () =>
        authz.requirePermission(worker.actor, 'investigations.create', ctx('probe.after')),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('refuses with no workspace context at all, because nothing holds a permission there', async () => {
    const { actor } = await member(owner);
    const c = ctx('probe.no_context');
    await expect(authz.requirePermission(actor, 'investigations.read', c)).rejects.toMatchObject({
      status: 403,
    });
    const [row] = await denialsFor(c.correlationId);
    expect(row).toMatchObject({ reason: 'workspace_context_missing' });
  });

  // Audit rows read as the owner: an entry belongs to the workspace it happened in, and the
  // application sees only its own (T-080).
  const denialsFor = (correlationId: string) =>
    ownerDb.select().from(auditLogs).where(eq(auditLogs.correlationId, correlationId));

  describe('customer work stays in a Personal workspace', () => {
    it('is allowed there', async () => {
      const me = await member(owner);
      const context = await resolver.resolve(me.actor, me.personalId);
      await expect(
        runInContext(context, () =>
          authz.requirePersonalWorkspace(me.actor, ctx('probe.personal')),
        ),
      ).resolves.toBeUndefined();
    });

    it('is refused in an agency, and audited as such', async () => {
      const me = await member(owner);
      const { tenantId } = await agency(owner, [{ userId: me.actor.userId }]);
      const context = await resolver.resolve(me.actor, tenantId);
      const c = ctx('probe.agency');

      await expect(
        runInContext(context, () => authz.requirePersonalWorkspace(me.actor, c)),
      ).rejects.toMatchObject({ status: 403 });

      const [row] = await denialsFor(c.correlationId);
      expect(row).toMatchObject({
        actorId: me.actor.userId,
        action: 'authz.denied.probe.agency',
        reason: 'workspace_kind_forbidden',
      });
    });

    it('is refused outside any workspace', async () => {
      const { actor } = await member(owner);
      const c = ctx('probe.no_workspace');
      await expect(authz.requirePersonalWorkspace(actor, c)).rejects.toMatchObject({ status: 403 });
      const [row] = await denialsFor(c.correlationId);
      expect(row).toMatchObject({ reason: 'workspace_context_missing' });
    });
  });

  describe('an agency’s own affairs stay in an agency (T-084)', () => {
    it('is allowed there', async () => {
      const me = await member(owner);
      const { tenantId } = await agency(owner, [{ userId: me.actor.userId }]);
      const context = await resolver.resolve(me.actor, tenantId);
      await expect(
        runInContext(context, () => authz.requireAgencyWorkspace(me.actor, ctx('probe.agency'))),
      ).resolves.toBeUndefined();
    });

    it('is refused in a Personal workspace, and audited as such', async () => {
      const me = await member(owner);
      const context = await resolver.resolve(me.actor, me.personalId);
      const c = ctx('probe.personal_agency');
      await expect(
        runInContext(context, () => authz.requireAgencyWorkspace(me.actor, c)),
      ).rejects.toMatchObject({ status: 403 });
      const [row] = await denialsFor(c.correlationId);
      expect(row).toMatchObject({ reason: 'workspace_kind_forbidden' });
    });

    it('is refused outside any workspace', async () => {
      const { actor } = await member(owner);
      const c = ctx('probe.no_workspace_agency');
      await expect(authz.requireAgencyWorkspace(actor, c)).rejects.toMatchObject({ status: 403 });
      const [row] = await denialsFor(c.correlationId);
      expect(row).toMatchObject({ reason: 'workspace_context_missing' });
    });
  });

  describe('nothing upward (T-085)', () => {
    it('passes when the caller holds every permission asked about, and refuses — audited — when not', async () => {
      const me = await member(owner);
      const { tenantId } = await agency(owner, [
        { userId: (await member(owner)).actor.userId },
        { userId: me.actor.userId, role: 'ADMIN' },
      ]);
      const context = await resolver.resolve(me.actor, tenantId);
      await expect(
        runInContext(context, () =>
          authz.requireHoldsAll(
            me.actor,
            ['employees.invite', 'settings.update'],
            ctx('probe.holds'),
          ),
        ),
      ).resolves.toBeUndefined();
      const c = ctx('probe.upward');
      await expect(
        runInContext(context, () =>
          authz.requireHoldsAll(me.actor, ['employees.invite', 'company.update_details'], c),
        ),
      ).rejects.toMatchObject({ status: 403 });
      const [row] = await denialsFor(c.correlationId);
      expect(row).toMatchObject({ reason: 'exceeds_own_permissions' });
    });

    it('is refused outside any workspace', async () => {
      const { actor } = await member(owner);
      const c = ctx('probe.no_workspace_holds');
      await expect(authz.requireHoldsAll(actor, [], c)).rejects.toMatchObject({ status: 403 });
      const [row] = await denialsFor(c.correlationId);
      expect(row).toMatchObject({ reason: 'workspace_context_missing' });
    });
  });

  it('never decides from a role name: what a role grants lives in one place', async () => {
    // Two roles with different names and the same grants must be indistinguishable to a check.
    // AGENCY_STAFF and VIEWER are exactly that today (tenancy.md §3, "Open").
    const [staff, viewer] = await Promise.all([granted('AGENCY_STAFF'), granted('VIEWER')]);
    expect(staff).toEqual(viewer);
  });

  it('gives a Personal workspace’s member the whole catalog', async () => {
    const me = await member(owner);
    const context = await resolver.resolve(me.actor, me.personalId);
    expect(context.permissions).toEqual([...TENANT_PERMISSIONS]);
  });

  it('asks for a permission the catalog knows, wherever the application asks', async () => {
    // A typo would be a check that can never pass. The type stops it at compile time; this
    // states it at runtime too, for the ones already in the services.
    const used: TenantPermission[] = [
      'company.read',
      'company.update',
      'investigations.create',
      'investigations.read',
      'investigations.update',
      'investigators.read',
      'investigators.update',
      'settings.read',
      'settings.update',
    ];
    const known = await owner<{ key: string }[]>`
      SELECT key FROM permissions WHERE key = ANY(${used})`;
    expect(known.map((r) => r.key).sort()).toEqual([...used].sort());
  });

  it('holds a suspended member’s permissions at nothing, whatever their role says', async () => {
    const boss = await member(owner);
    const worker = await member(owner);
    const { tenantId, memberships } = await agency(owner, [
      { userId: boss.actor.userId },
      { userId: worker.actor.userId, role: 'ADMIN' },
    ]);
    await owner`
      UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE id = ${memberships[1]!}`;
    await expect(resolver.resolve(worker.actor, tenantId)).rejects.toMatchObject({ status: 403 });
    const [membership] = await owner<{ status: string }[]>`
      SELECT status FROM tenant_memberships WHERE id = ${memberships[1]!}`;
    expect(membership!.status).toBe('SUSPENDED');
  });

  it('leaves the audit trail able to say which check refused', async () => {
    // A Viewer of a real agency, asking for the one permission only an Owner holds. The refusal
    // has to name the check, or a burst of them tells an investigator nothing.
    const { actor, context } = await memberWith('VIEWER');
    const c = ctx('probe.reason');
    await expect(
      runInContext(context, () => authz.requirePermission(actor, 'billing.manage', c)),
    ).rejects.toMatchObject({ status: 403 });
    const [row] = await denialsFor(c.correlationId);
    expect(row).toMatchObject({
      reason: 'permission_not_held',
      action: 'authz.denied.probe.reason',
      actorId: actor.userId,
    });
  });
  it('checks the workspace the request is in, not the one the actor happens to own', async () => {
    const me = await member(owner);
    const { tenantId } = await agency(owner, [{ userId: me.actor.userId }]);
    const personal = await resolver.resolve(me.actor, me.personalId);
    const inAgency = await resolver.resolve(me.actor, tenantId);
    expect(personal.tenantKind).toBe('PERSONAL');
    expect(inAgency.tenantKind).toBe('AGENCY');
    await expect(
      runInContext(inAgency, () => authz.requirePersonalWorkspace(me.actor, ctx('probe.both'))),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      runInContext(personal, () => authz.requirePersonalWorkspace(me.actor, ctx('probe.both'))),
    ).resolves.toBeUndefined();
  });

  it('never lets a narrowed platform role widen a workspace permission', async () => {
    // Narrowing is a platform-role concept; it cannot add a tenant permission, and the two are
    // resolved from different places on purpose.
    const boss = await member(owner);
    const worker = await member(owner);
    const { tenantId } = await agency(owner, [
      { userId: boss.actor.userId },
      { userId: worker.actor.userId, role: 'VIEWER' },
    ]);
    const narrowed: Actor = { ...worker.actor, activeRole: 'INVESTIGATOR' };
    const context = await resolver.resolve(narrowed, tenantId);
    expect(context.permissions).not.toContain('investigations.create');
    await expect(
      runInContext(context, () =>
        authz.requirePermission(narrowed, 'investigations.create', ctx('probe.narrowed')),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('gives no permission to a workspace the caller is not in', async () => {
    const stranger = await member(owner);
    const boss = await member(owner);
    const { tenantId } = await agency(owner, [{ userId: boss.actor.userId }]);
    await expect(resolver.resolve(stranger.actor, tenantId)).rejects.toMatchObject({ status: 403 });
  });

  it('separates two members of the same workspace by their own roles', async () => {
    const boss = await member(owner);
    const viewer = await member(owner);
    const { tenantId } = await agency(owner, [
      { userId: boss.actor.userId },
      { userId: viewer.actor.userId, role: 'VIEWER' },
    ]);
    const bossContext = await resolver.resolve(boss.actor, tenantId);
    const viewerContext = await resolver.resolve(viewer.actor, tenantId);
    expect(bossContext.permissions).toContain('billing.manage');
    expect(viewerContext.permissions).not.toContain('billing.manage');
    expect(viewerContext.permissions).toContain('company.read');
  });

  it('resolves the membership of the workspace asked for, not another of the caller’s', async () => {
    const me = await member(owner);
    const { tenantId } = await agency(owner, [{ userId: me.actor.userId }]);
    const inAgency = await resolver.resolve(me.actor, tenantId);
    const personal = await resolver.resolve(me.actor, me.personalId);
    expect(inAgency.membershipId).not.toBe(personal.membershipId);
    const [mine] = await owner<{ tenant: string }[]>`
      SELECT tenant_id AS tenant FROM tenant_memberships WHERE id = ${inAgency.membershipId}`;
    expect(mine!.tenant).toBe(tenantId);
  });
});
