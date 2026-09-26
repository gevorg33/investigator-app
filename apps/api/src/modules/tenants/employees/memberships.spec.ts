import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { employeesApp } from '../../../../test/employees-harness';

/**
 * An agency's members over HTTP (T-085): what changes, and that it lands on the member's **next**
 * request — the membership is read per request, so the next request is the test.
 */
describe('agency members', () => {
  let h: Awaited<ReturnType<typeof employeesApp>>;

  beforeAll(async () => {
    h = await employeesApp();
  });

  afterAll(async () => {
    await h.close();
  });

  const MEMBERS = '/agencies/current/members';
  type Person = Awaited<ReturnType<typeof h.signedIn>>;

  /** An owner, and colleagues with the roles given, in a new agency. */
  const team = async (...roles: string[]) => {
    const people: Person[] = [];
    for (let i = 0; i <= roles.length; i++) people.push(await h.signedIn());
    const { tenantId, memberships } = await h.agencyOf(
      people.map((who, i) => ({ who, ...(i > 0 && { role: roles[i - 1] }) })),
    );
    return { tenantId, memberships, owner: people[0]!, others: people.slice(1) };
  };

  const audited = (action: string, resourceId: string) =>
    h.owner<{ reason: string | null; actor_id: string }[]>`
      SELECT reason, actor_id FROM audit_logs WHERE action = ${action} AND resource_id = ${resourceId}`;

  describe('the list', () => {
    it('shows every member who has not left, their roles and details, identity read from the user', async () => {
      const t = await team('VIEWER');
      const res = await h.as(t.others[0]!, t.tenantId).get(MEMBERS);
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      const me = res.body.find((m: { you: boolean }) => m.you);
      expect(me).toMatchObject({
        membershipId: t.memberships[1],
        userId: t.others[0]!.actor.userId,
        email: t.others[0]!.email,
        status: 'ACTIVE',
        roles: ['VIEWER'],
        jobTitle: null,
      });
      expect(res.body.find((m: { you: boolean }) => !m.you).roles).toEqual(['OWNER']);
    });

    it('exists only in an agency, and only for a member of it', async () => {
      const t = await team();
      expect((await h.as(t.owner).get(MEMBERS)).status).toBe(403);
      const stranger = await h.signedIn();
      expect((await h.as(stranger, t.tenantId).get(MEMBERS)).status).toBe(403);
    });
  });

  describe('details', () => {
    it('sets and clears a member’s job title, department, locale and time zone, and audits which', async () => {
      const t = await team('VIEWER');
      const id = t.memberships[1]!;
      const res = await h.as(t.owner, t.tenantId).patch(`${MEMBERS}/${id}`, {
        jobTitle: '  Field investigator ',
        department: 'Due diligence',
        locale: 'hy',
        timezone: 'Asia/Yerevan',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        jobTitle: 'Field investigator',
        department: 'Due diligence',
        locale: 'hy',
        timezone: 'Asia/Yerevan',
      });
      expect(await audited('employees.updated', id)).toEqual([
        { reason: 'jobTitle,department,locale,timezone', actor_id: t.owner.actor.userId },
      ]);
      const cleared = await h.as(t.owner, t.tenantId).patch(`${MEMBERS}/${id}`, {
        jobTitle: null,
        department: '   ',
        locale: null,
      });
      expect(cleared.body).toMatchObject({ jobTitle: null, department: null, locale: null });
      expect(cleared.body.timezone).toBe('Asia/Yerevan');
    });

    it('changes nothing, and audits nothing, when nothing is sent', async () => {
      const t = await team('VIEWER');
      const id = t.memberships[1]!;
      expect((await h.as(t.owner, t.tenantId).patch(`${MEMBERS}/${id}`, {})).status).toBe(200);
      expect(await audited('employees.updated', id)).toEqual([]);
    });

    it('refuses each bad value by its own field and message', async () => {
      const t = await team('VIEWER');
      const res = await h.as(t.owner, t.tenantId).patch(`${MEMBERS}/${t.memberships[1]}`, {
        jobTitle: 'x'.repeat(121),
        locale: 'fr',
        timezone: '+04:00',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'jobTitle',
            messageKey: 'error.validation.employees.text_length',
          }),
          expect.objectContaining({
            field: 'locale',
            messageKey: 'error.validation.language_code.invalid',
          }),
          expect.objectContaining({ field: 'timezone' }),
        ]),
      );
    });

    it('is not for a member who cannot change employees', async () => {
      const t = await team('VIEWER');
      const res = await h
        .as(t.others[0]!, t.tenantId)
        .patch(`${MEMBERS}/${t.memberships[0]}`, { jobTitle: 'Owner' });
      expect(res.status).toBe(403);
    });

    it('does not reach a member of another agency, or one who left', async () => {
      const t = await team('VIEWER');
      const other = await team();
      const res = await h
        .as(t.owner, t.tenantId)
        .patch(`${MEMBERS}/${other.memberships[0]}`, { jobTitle: 'x' });
      expect(res.status).toBe(404);
      await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${t.memberships[1]}/remove`);
      const gone = await h
        .as(t.owner, t.tenantId)
        .patch(`${MEMBERS}/${t.memberships[1]}`, { jobTitle: 'x' });
      expect(gone.status).toBe(404);
    });
  });

  describe('roles', () => {
    it('replaces a member’s roles, and the new permissions apply on their next request', async () => {
      const t = await team('VIEWER');
      const viewer = t.others[0]!;
      const id = t.memberships[1]!;
      // A viewer cannot invite…
      expect(
        (
          await h.as(viewer, t.tenantId).post('/agencies/current/invitations', {
            email: `x-${randomUUID()}@example.test`,
            role: 'VIEWER',
          })
        ).status,
      ).toBe(403);
      const res = await h.as(t.owner, t.tenantId).put(`${MEMBERS}/${id}/roles`, {
        roles: ['ADMIN', 'MANAGER'],
      });
      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual(['ADMIN', 'MANAGER']);
      expect(await audited('employees.roles_changed', id)).toEqual([
        { reason: 'ADMIN,MANAGER', actor_id: t.owner.actor.userId },
      ]);
      // …and, the very next request, an admin can.
      expect(
        (
          await h.as(viewer, t.tenantId).post('/agencies/current/invitations', {
            email: `x-${randomUUID()}@example.test`,
            role: 'VIEWER',
          })
        ).status,
      ).toBe(201);
    });

    it('refuses a role that does not exist, and an empty set', async () => {
      const t = await team('VIEWER');
      const path = `${MEMBERS}/${t.memberships[1]}/roles`;
      const unknown = await h.as(t.owner, t.tenantId).put(path, { roles: ['SUPERUSER'] });
      // Well-formed, but not a role the catalog has: the service's refusal (422), not the pipe's.
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.details).toEqual([
        { field: 'roles', code: 'UNKNOWN', messageKey: 'error.validation.employees.role_unknown' },
      ]);
      const none = await h.as(t.owner, t.tenantId).put(path, { roles: [] });
      expect(none.body.error.details[0].messageKey).toBe(
        'error.validation.employees.role_required',
      );
    });

    it('takes a role of the workspace’s own, even one that grants nothing', async () => {
      // Custom roles are a later addition to the same tables (tenancy.md §3): the catalog reader
      // already finds this workspace's roles beside the system ones, and a role with no grants
      // is a role, not an error.
      const t = await team('VIEWER');
      await h.owner`INSERT INTO roles (key, tenant_id, name) VALUES ('NOTHING', ${t.tenantId}, 'Nothing')`;
      const res = await h
        .as(t.owner, t.tenantId)
        .put(`${MEMBERS}/${t.memberships[1]}/roles`, { roles: ['NOTHING'] });
      expect(res.status).toBe(200);
      expect(res.body.roles).toEqual(['NOTHING']);
      // Another agency does not have it.
      const other = await team('VIEWER');
      const elsewhere = await h
        .as(other.owner, other.tenantId)
        .put(`${MEMBERS}/${other.memberships[1]}/roles`, { roles: ['NOTHING'] });
      expect(elsewhere.status).toBe(422);
    });

    it('never leaves the agency without an active owner', async () => {
      const t = await team('VIEWER');
      const res = await h
        .as(t.owner, t.tenantId)
        .put(`${MEMBERS}/${t.memberships[0]}/roles`, { roles: ['ADMIN'] });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual([
        {
          field: 'membership',
          code: 'LAST_OWNER',
          messageKey: 'error.validation.employees.last_owner',
        },
      ]);
      // Nothing moved.
      const list = await h.as(t.owner, t.tenantId).get(MEMBERS);
      expect(list.body.find((m: { you: boolean }) => m.you).roles).toEqual(['OWNER']);
    });

    it('lets ownership move: a second owner, then the first steps down', async () => {
      const t = await team('VIEWER');
      await h
        .as(t.owner, t.tenantId)
        .put(`${MEMBERS}/${t.memberships[1]}/roles`, { roles: ['OWNER'] });
      const down = await h
        .as(t.owner, t.tenantId)
        .put(`${MEMBERS}/${t.memberships[0]}/roles`, { roles: ['ADMIN'] });
      expect(down.status).toBe(200);
      expect(down.body.roles).toEqual(['ADMIN']);
    });
  });

  describe('nothing upward', () => {
    it('lets an admin grant only what an admin holds', async () => {
      const t = await team('ADMIN', 'VIEWER');
      const admin = t.others[0]!;
      const viewerId = t.memberships[2]!;
      const path = `${MEMBERS}/${viewerId}/roles`;
      expect((await h.as(admin, t.tenantId).put(path, { roles: ['OWNER'] })).status).toBe(403);
      expect((await h.as(admin, t.tenantId).put(path, { roles: ['MANAGER'] })).status).toBe(200);
      const [denied] = await h.owner<{ reason: string }[]>`
        SELECT reason FROM audit_logs
         WHERE action = 'authz.denied.employees.set_roles' AND resource_id = ${viewerId}`;
      expect(denied!.reason).toBe('exceeds_own_permissions');
    });

    it('lets an admin act on no owner — not their details, roles, suspension or removal', async () => {
      const t = await team('ADMIN');
      const admin = t.others[0]!;
      const ownerId = t.memberships[0]!;
      const on = (suffix: string) => `${MEMBERS}/${ownerId}${suffix}`;
      expect((await h.as(admin, t.tenantId).patch(on(''), { jobTitle: 'x' })).status).toBe(403);
      expect((await h.as(admin, t.tenantId).put(on('/roles'), { roles: ['VIEWER'] })).status).toBe(
        403,
      );
      expect((await h.as(admin, t.tenantId).post(on('/suspend'))).status).toBe(403);
      expect((await h.as(admin, t.tenantId).post(on('/remove'))).status).toBe(403);
      expect((await h.as(t.owner, t.tenantId).get('/agencies/current/members')).status).toBe(200);
    });
  });

  describe('suspending', () => {
    it('refuses the member on their next request, keeps their roles, and lets them back in', async () => {
      const t = await team('INVESTIGATOR');
      const member = t.others[0]!;
      const id = t.memberships[1]!;
      expect((await h.as(member, t.tenantId).get(MEMBERS)).status).toBe(200);

      const res = await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${id}/suspend`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'SUSPENDED', roles: ['INVESTIGATOR'] });
      expect((await h.as(member, t.tenantId).get(MEMBERS)).status).toBe(403);
      // Their own Personal workspace is theirs regardless.
      expect((await h.as(member).get('/workspaces')).status).toBe(200);
      expect(await audited('employees.suspended', id)).toHaveLength(1);

      const back = await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${id}/reactivate`);
      expect(back.body).toMatchObject({ status: 'ACTIVE', roles: ['INVESTIGATOR'] });
      expect((await h.as(member, t.tenantId).get(MEMBERS)).status).toBe(200);
      expect(await audited('employees.reactivated', id)).toHaveLength(1);
    });

    it('is refused for yourself, twice over, or the other way round', async () => {
      const t = await team('ADMIN', 'VIEWER');
      const admin = t.others[0]!;
      const self = await h.as(admin, t.tenantId).post(`${MEMBERS}/${t.memberships[1]}/suspend`);
      expect(self.status).toBe(409);
      expect(self.body.error.details[0].messageKey).toBe('error.validation.employees.not_yourself');
      const path = `${MEMBERS}/${t.memberships[2]}`;
      expect((await h.as(admin, t.tenantId).post(`${path}/reactivate`)).status).toBe(403);
      await h.as(admin, t.tenantId).post(`${path}/suspend`);
      expect((await h.as(admin, t.tenantId).post(`${path}/suspend`)).status).toBe(403);
    });

    it('lets one of two owners suspend the other, who is then refused', async () => {
      // The last owner cannot be suspended at all: not by themselves (above), not by anyone who
      // holds less (nothing upward), and the database would refuse it at commit regardless.
      const t = await team('OWNER');
      const res = await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${t.memberships[1]}/suspend`);
      expect(res.status).toBe(200);
      expect((await h.as(t.others[0]!, t.tenantId).get(MEMBERS)).status).toBe(403);
    });

    it('archives the member’s AI sessions in this workspace, and only these', async () => {
      const t = await team('VIEWER');
      const viewer = t.others[0]!.actor.userId;
      const insert = (tenant: string) => h.owner<{ id: string }[]>`
        INSERT INTO ai_sessions (tenant_id, user_id) VALUES (${tenant}, ${viewer}) RETURNING id`;
      const [here] = await insert(t.tenantId);
      const [personal] = await insert(t.others[0]!.personalId);
      await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${t.memberships[1]}/suspend`);
      const rows = await h.owner<{ id: string; archived: boolean }[]>`
        SELECT id, archived_at IS NOT NULL AS archived FROM ai_sessions
         WHERE id IN (${here!.id}, ${personal!.id})`;
      expect(Object.fromEntries(rows.map((r) => [r.id, r.archived]))).toEqual({
        [here!.id]: true,
        [personal!.id]: false,
      });
    });

    it('is not for a member who cannot suspend', async () => {
      const t = await team('MANAGER', 'VIEWER');
      const res = await h
        .as(t.others[0]!, t.tenantId)
        .post(`${MEMBERS}/${t.memberships[2]}/suspend`);
      expect(res.status).toBe(403);
    });
  });

  describe('removing', () => {
    it('refuses the member on their next request, takes their roles, and keeps the row', async () => {
      const t = await team('VIEWER');
      const member = t.others[0]!;
      const id = t.memberships[1]!;
      const res = await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${id}/remove`);
      expect(res.status).toBe(204);
      expect((await h.as(member, t.tenantId).get(MEMBERS)).status).toBe(403);
      const [row] = await h.owner<{ status: string; roles: number }[]>`
        SELECT m.status, (SELECT count(*)::int FROM membership_roles r WHERE r.membership_id = m.id) AS roles
          FROM tenant_memberships m WHERE m.id = ${id}`;
      expect(row).toEqual({ status: 'REMOVED', roles: 0 });
      const list = await h.as(t.owner, t.tenantId).get(MEMBERS);
      expect(list.body.map((m: { membershipId: string }) => m.membershipId)).toEqual([
        t.memberships[0],
      ]);
      expect(await audited('employees.removed', id)).toHaveLength(1);
      // Gone is gone: a second removal finds nobody.
      expect((await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${id}/remove`)).status).toBe(404);
    });

    it('never removes the last owner — themselves included', async () => {
      const t = await team('VIEWER');
      const res = await h.as(t.owner, t.tenantId).post(`${MEMBERS}/${t.memberships[0]}/remove`);
      expect(res.status).toBe(409);
      expect(res.body.error.details[0].messageKey).toBe('error.validation.employees.last_owner');
      expect((await h.as(t.owner, t.tenantId).get(MEMBERS)).status).toBe(200);
    });

    it('is not for a member who cannot remove', async () => {
      const t = await team('MANAGER', 'VIEWER');
      const res = await h
        .as(t.others[0]!, t.tenantId)
        .post(`${MEMBERS}/${t.memberships[2]}/remove`);
      expect(res.status).toBe(403);
    });
  });
});
