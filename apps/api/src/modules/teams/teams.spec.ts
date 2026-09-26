import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { employeesApp } from '../../../test/employees-harness';

/** An agency's teams over HTTP (T-086): who may change them, who is in them, and whose they are. */
describe('agency teams', () => {
  let h: Awaited<ReturnType<typeof employeesApp>>;

  beforeAll(async () => {
    h = await employeesApp();
  });

  afterAll(async () => {
    await h.close();
  });

  const TEAMS = '/agencies/current/teams';
  type Person = Awaited<ReturnType<typeof h.signedIn>>;

  const agencyWith = async (...roles: string[]) => {
    const people: Person[] = [];
    for (let i = 0; i <= roles.length; i++) people.push(await h.signedIn());
    const { tenantId, memberships } = await h.agencyOf(
      people.map((who, i) => ({ who, ...(i > 0 && { role: roles[i - 1] }) })),
    );
    return { tenantId, memberships, owner: people[0]!, others: people.slice(1) };
  };

  const audited = (action: string, teamId: string) =>
    h.owner<{ reason: string | null }[]>`
      SELECT reason FROM audit_logs WHERE action = ${action} AND resource_id = ${teamId}`;

  describe('creating and changing', () => {
    it('creates a team, trimmed, and lists it for every member', async () => {
      const a = await agencyWith('VIEWER');
      const res = await h.as(a.owner, a.tenantId).post(TEAMS, {
        name: '  Field ',
        description: ' Surveillance in Yerevan ',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        name: 'Field',
        description: 'Surveillance in Yerevan',
        members: [],
      });
      expect(await audited('teams.created', res.body.id)).toHaveLength(1);
      const list = await h.as(a.others[0]!, a.tenantId).get(TEAMS);
      expect(list.status).toBe(200);
      expect(list.body.map((t: { name: string }) => t.name)).toEqual(['Field']);
    });

    it('lists teams by name, whatever the case', async () => {
      const a = await agencyWith();
      for (const name of ['beta', 'Alpha', 'gamma']) {
        await h.as(a.owner, a.tenantId).post(TEAMS, { name });
      }
      const list = await h.as(a.owner, a.tenantId).get(TEAMS);
      expect(list.body.map((t: { name: string }) => t.name)).toEqual(['Alpha', 'beta', 'gamma']);
    });

    it('refuses two teams of the same name in one agency — but not in two', async () => {
      const a = await agencyWith();
      const b = await agencyWith();
      await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      const again = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'FIELD' });
      expect(again.status).toBe(409);
      expect(again.body.error.details).toEqual([
        { field: 'name', code: 'TAKEN', messageKey: 'error.validation.teams.name_taken' },
      ]);
      expect((await h.as(b.owner, b.tenantId).post(TEAMS, { name: 'Field' })).status).toBe(201);
      // A rename into a taken name is the same refusal.
      const other = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Office' });
      const renamed = await h.as(a.owner, a.tenantId).patch(`${TEAMS}/${other.body.id}`, {
        name: 'field',
      });
      expect(renamed.status).toBe(409);
    });

    it('refuses a blank or overlong name, and an overlong description', async () => {
      const a = await agencyWith();
      const blank = await h.as(a.owner, a.tenantId).post(TEAMS, { name: '   ' });
      expect(blank.status).toBe(422);
      expect(blank.body.error.details[0].messageKey).toBe('error.validation.teams.name_length');
      const long = await h.as(a.owner, a.tenantId).post(TEAMS, {
        name: 'x'.repeat(81),
        description: 'y'.repeat(501),
      });
      expect(long.status).toBe(400);
      expect(long.body.error.details.map((d: { messageKey: string }) => d.messageKey)).toEqual([
        'error.validation.teams.name_length',
        'error.validation.teams.description_length',
      ]);
      const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      const blankRename = await h
        .as(a.owner, a.tenantId)
        .patch(`${TEAMS}/${team.body.id}`, { name: ' ' });
      expect(blankRename.status).toBe(422);
    });

    it('renames, clears and changes the description, and audits which', async () => {
      const a = await agencyWith();
      const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field', description: 'x' });
      const id = team.body.id;
      const res = await h
        .as(a.owner, a.tenantId)
        .patch(`${TEAMS}/${id}`, { name: 'Field team', description: null });
      expect(res.body).toMatchObject({ name: 'Field team', description: null });
      const again = await h
        .as(a.owner, a.tenantId)
        .patch(`${TEAMS}/${id}`, { description: '  Yerevan ' });
      expect(again.body.description).toBe('Yerevan');
      expect((await h.as(a.owner, a.tenantId).patch(`${TEAMS}/${id}`, {})).status).toBe(200);
      expect((await audited('teams.updated', id)).map((r) => r.reason)).toEqual([
        'name,description',
        'description',
      ]);
    });

    it('deletes a team — its members stay in the agency', async () => {
      const a = await agencyWith('VIEWER');
      const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      await h
        .as(a.owner, a.tenantId)
        .post(`${TEAMS}/${team.body.id}/members`, { membershipId: a.memberships[1] });
      const res = await h.as(a.owner, a.tenantId).delete(`${TEAMS}/${team.body.id}`);
      expect(res.status).toBe(204);
      expect((await h.as(a.owner, a.tenantId).get(`${TEAMS}/${team.body.id}`)).status).toBe(404);
      expect((await h.as(a.others[0]!, a.tenantId).get('/agencies/current/members')).status).toBe(
        200,
      );
      expect(await audited('teams.deleted', team.body.id)).toHaveLength(1);
    });
  });

  describe('who may', () => {
    it('lets a manager create, change and delete; a viewer only read', async () => {
      const a = await agencyWith('MANAGER', 'VIEWER');
      const [manager, viewer] = a.others as [Person, Person];
      const team = await h.as(manager, a.tenantId).post(TEAMS, { name: 'Field' });
      expect(team.status).toBe(201);
      const id = team.body.id;
      expect((await h.as(viewer, a.tenantId).get(`${TEAMS}/${id}`)).status).toBe(200);
      expect((await h.as(viewer, a.tenantId).post(TEAMS, { name: 'Mine' })).status).toBe(403);
      expect((await h.as(viewer, a.tenantId).patch(`${TEAMS}/${id}`, { name: 'x' })).status).toBe(
        403,
      );
      expect(
        (
          await h.as(viewer, a.tenantId).post(`${TEAMS}/${id}/members`, {
            membershipId: a.memberships[2],
          })
        ).status,
      ).toBe(403);
      expect((await h.as(viewer, a.tenantId).delete(`${TEAMS}/${id}`)).status).toBe(403);
      expect((await h.as(manager, a.tenantId).delete(`${TEAMS}/${id}`)).status).toBe(204);
    });

    it('exists only in an agency', async () => {
      const a = await agencyWith();
      expect((await h.as(a.owner).get(TEAMS)).status).toBe(403);
    });
  });

  describe('members', () => {
    it('puts members in and takes them out, once each, and a member may be in several teams', async () => {
      const a = await agencyWith('INVESTIGATOR');
      const investigator = a.others[0]!;
      const id = a.memberships[1]!;
      const field = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      const office = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Office' });
      for (const team of [field.body.id, office.body.id]) {
        const res = await h.as(a.owner, a.tenantId).post(`${TEAMS}/${team}/members`, {
          membershipId: id,
        });
        expect(res.status).toBe(200);
        expect(res.body.members).toEqual([
          {
            membershipId: id,
            userId: investigator.actor.userId,
            email: investigator.email,
            displayName: null,
            status: 'ACTIVE',
          },
        ]);
      }
      // Twice is once, and audited once.
      await h
        .as(a.owner, a.tenantId)
        .post(`${TEAMS}/${field.body.id}/members`, { membershipId: id });
      expect(await audited('teams.member_added', field.body.id)).toEqual([{ reason: id }]);

      const out = await h.as(a.owner, a.tenantId).delete(`${TEAMS}/${field.body.id}/members/${id}`);
      expect(out.status).toBe(200);
      expect(out.body.members).toEqual([]);
      const again = await h
        .as(a.owner, a.tenantId)
        .delete(`${TEAMS}/${field.body.id}/members/${id}`);
      expect(again.status).toBe(200);
      expect(await audited('teams.member_removed', field.body.id)).toEqual([{ reason: id }]);
      const office2 = await h.as(a.owner, a.tenantId).get(`${TEAMS}/${office.body.id}`);
      expect(office2.body.members).toHaveLength(1);
    });

    it('keeps a suspended member in their teams, as they keep their roles', async () => {
      const a = await agencyWith('VIEWER');
      const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      await h
        .as(a.owner, a.tenantId)
        .post(`${TEAMS}/${team.body.id}/members`, { membershipId: a.memberships[1] });
      await h.as(a.owner, a.tenantId).post(`/agencies/current/members/${a.memberships[1]}/suspend`);
      const res = await h.as(a.owner, a.tenantId).get(`${TEAMS}/${team.body.id}`);
      expect(res.body.members[0].status).toBe('SUSPENDED');
    });

    it('takes a removed member out of every team, and lets nobody put them back', async () => {
      const a = await agencyWith('VIEWER');
      const id = a.memberships[1]!;
      const teams = [];
      for (const name of ['Field', 'Office']) {
        const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name });
        await h
          .as(a.owner, a.tenantId)
          .post(`${TEAMS}/${team.body.id}/members`, { membershipId: id });
        teams.push(team.body.id as string);
      }
      await h.as(a.owner, a.tenantId).post(`/agencies/current/members/${id}/remove`);
      const [row] = await h.owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM team_members WHERE membership_id = ${id}`;
      expect(row!.n).toBe(0);
      const back = await h.as(a.owner, a.tenantId).post(`${TEAMS}/${teams[0]}/members`, {
        membershipId: id,
      });
      expect(back.status).toBe(422);
      expect(back.body.error.details[0].messageKey).toBe('error.validation.teams.member_unknown');
      // Written straight to the table, the database refuses it too.
      await expect(
        h.owner`INSERT INTO team_members (team_id, membership_id, tenant_id)
                VALUES (${teams[0]!}, ${id}, ${a.tenantId})`,
      ).rejects.toThrow(/team_members_member_present/);
    });

    it('refuses someone who is not a member of this agency', async () => {
      const a = await agencyWith();
      const b = await agencyWith();
      const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      const res = await h.as(a.owner, a.tenantId).post(`${TEAMS}/${team.body.id}/members`, {
        membershipId: b.memberships[0],
      });
      expect(res.status).toBe(422);
      // Written straight to the table under either agency's id, the composite keys refuse it.
      for (const tenant of [a.tenantId, b.tenantId]) {
        await expect(
          h.owner`INSERT INTO team_members (team_id, membership_id, tenant_id)
                  VALUES (${team.body.id}, ${b.memberships[0]!}, ${tenant})`,
        ).rejects.toThrow(/team_members_(team|membership)_fk/);
      }
      const malformed = await h
        .as(a.owner, a.tenantId)
        .post(`${TEAMS}/${team.body.id}/members`, { membershipId: 'nobody' });
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.details[0].messageKey).toBe(
        'error.validation.teams.member_unknown',
      );
    });
  });

  describe('another agency', () => {
    it('cannot see, change, fill or delete this agency’s team', async () => {
      const a = await agencyWith('VIEWER');
      const b = await agencyWith();
      const team = await h.as(a.owner, a.tenantId).post(TEAMS, { name: 'Field' });
      const id = team.body.id;
      const them = h.as(b.owner, b.tenantId);
      expect((await them.get(TEAMS)).body).toEqual([]);
      expect((await them.get(`${TEAMS}/${id}`)).status).toBe(404);
      expect((await them.patch(`${TEAMS}/${id}`, { name: 'Taken' })).status).toBe(404);
      expect(
        (await them.post(`${TEAMS}/${id}/members`, { membershipId: b.memberships[0] })).status,
      ).toBe(404);
      expect((await them.delete(`${TEAMS}/${id}/members/${a.memberships[1]}`)).status).toBe(404);
      expect((await them.delete(`${TEAMS}/${id}`)).status).toBe(404);
      const still = await h.as(a.owner, a.tenantId).get(`${TEAMS}/${id}`);
      expect(still.body).toMatchObject({ name: 'Field' });
    });
  });
});
