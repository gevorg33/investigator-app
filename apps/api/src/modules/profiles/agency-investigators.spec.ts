import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { employeesApp } from '../../../test/employees-harness';
import { agencyContext } from '../../../test/workspace-context';
import { runInContext } from '../../common/context/execution-context';
import { AgencyInvestigatorsService } from './agency-investigators.service';

/**
 * Investigator profiles under workspaces, over HTTP (T-087): an agency makes a profile for a
 * member, who holds it; the agency manages its storefront; the holder works with it in the agency
 * and with their own profile in their Personal workspace, and the two never stand in for each other.
 */
/**
 * A unique, letters-only word from an id: a pseudonym with six digits in it reads as a phone number
 * and is refused (`pseudonym.ts`), which a hex slice of an id is, one time in sixteen.
 */
const lettersOf = (id: string) =>
  id
    .replace(/-/g, '')
    .slice(0, 8)
    .replace(/\d/g, (d) => 'ghijklmnop'[Number(d)]!);

describe('agency investigator profiles', () => {
  let h: Awaited<ReturnType<typeof employeesApp>>;

  beforeAll(async () => {
    h = await employeesApp();
  });

  afterAll(async () => {
    await h.close();
  });

  const PROFILES = '/agencies/current/investigators';
  type Person = Awaited<ReturnType<typeof h.signedIn>>;

  /** Someone who has taken up the INVESTIGATOR role, with the legal name given. */
  const investigator = async (legalName = 'Test Agent') => {
    const who = await h.signedIn();
    await h.owner`INSERT INTO user_roles (user_id, role) VALUES (${who.actor.userId}, 'INVESTIGATOR')`;
    await h.owner`UPDATE users SET display_name = ${legalName} WHERE id = ${who.actor.userId}`;
    return who;
  };

  /** An agency: its owner, then the people given with their roles. */
  const team = async (...people: Array<{ who: Person; role: string }>) => {
    const owner = await h.signedIn();
    const { tenantId, memberships } = await h.agencyOf([{ who: owner }, ...people]);
    return { tenantId, owner, membershipOf: (i: number) => memberships[i + 1]! };
  };

  const audited = (action: string, resourceId: string) =>
    h.owner<{ reason: string | null; actor_id: string }[]>`
      SELECT reason, actor_id FROM audit_logs WHERE action = ${action} AND resource_id = ${resourceId}`;

  /** What the database holds for a profile, read as the owner. */
  const stored = async (profileId: string) => {
    const [row] = await h.owner<
      { tenant_id: string; user_id: string; visibility: string; accepting_work: boolean }[]
    >`SELECT tenant_id, user_id, visibility, accepting_work FROM investigator_profiles
       WHERE id = ${profileId}`;
    return row!;
  };

  /** Makes the profile one discovery would list: published, verified, taking work. */
  const listable = (profileId: string) => h.owner`
    UPDATE investigator_profiles
       SET visibility = 'PUBLISHED', accepting_work = true,
           verification_status = 'VERIFIED', verified_at = now()
     WHERE id = ${profileId}`;

  describe('making one for a member', () => {
    it('makes an unverified draft in the agency, held by the member’s membership, and audits it', async () => {
      const agent = await investigator();
      const t = await team({ who: agent, role: 'INVESTIGATOR' });

      const res = await h
        .as(t.owner, t.tenantId)
        .post(PROFILES, { membershipId: t.membershipOf(0) });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        membershipId: t.membershipOf(0),
        holderStatus: 'ACTIVE',
        userId: agent.actor.userId,
        visibility: 'DRAFT',
        verificationStatus: 'UNVERIFIED',
        acceptingWork: false,
        agency: { id: t.tenantId },
      });
      expect(await stored(res.body.id)).toMatchObject({
        tenant_id: t.tenantId,
        user_id: agent.actor.userId,
      });
      expect(await audited('agency_investigators.created', res.body.id)).toEqual([
        { reason: t.membershipOf(0), actor_id: t.owner.actor.userId },
      ]);
    });

    it('runs several per agency, one per person — beside the person’s own Personal profile', async () => {
      const a = await investigator();
      const b = await investigator();
      const t = await team({ who: a, role: 'INVESTIGATOR' }, { who: b, role: 'INVESTIGATOR' });
      // `a` also works independently, from their Personal workspace.
      expect((await h.as(a).post('/profiles/roles', { role: 'INVESTIGATOR' })).status).toBe(201);

      const made = [];
      for (const i of [0, 1]) {
        const res = await h
          .as(t.owner, t.tenantId)
          .post(PROFILES, { membershipId: t.membershipOf(i) });
        expect(res.status).toBe(201);
        made.push(res.body.id as string);
      }
      const again = await h
        .as(t.owner, t.tenantId)
        .post(PROFILES, { membershipId: t.membershipOf(0) });
      expect(again.status).toBe(409);
      expect(again.body.error.details).toEqual([
        expect.objectContaining({ field: 'membershipId', code: 'ALREADY_HELD' }),
      ]);

      const list = await h.as(t.owner, t.tenantId).get(PROFILES);
      expect(list.status).toBe(200);
      expect(list.body.map((p: { id: string }) => p.id)).toEqual(made);
      // Two profiles for `a`, one per workspace; identity is the account's, held once.
      const theirs = await h.owner<{ tenant_id: string }[]>`
        SELECT tenant_id FROM investigator_profiles WHERE user_id = ${a.actor.userId}`;
      expect(new Set(theirs.map((r) => r.tenant_id))).toEqual(new Set([t.tenantId, a.personalId]));
    });

    it('refuses a member who has not taken up the investigator role themself', async () => {
      const plain = await h.signedIn();
      const t = await team({ who: plain, role: 'INVESTIGATOR' });
      const res = await h
        .as(t.owner, t.tenantId)
        .post(PROFILES, { membershipId: t.membershipOf(0) });
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual([
        expect.objectContaining({ field: 'membershipId', code: 'NOT_AN_INVESTIGATOR' }),
      ]);
    });

    it('refuses without investigators.create, outside an agency, a suspended member, and another agency’s', async () => {
      const agent = await investigator();
      const manager = await h.signedIn();
      const t = await team({ who: agent, role: 'INVESTIGATOR' }, { who: manager, role: 'MANAGER' });
      const body = { membershipId: t.membershipOf(0) };

      const refused = await h.as(manager, t.tenantId).post(PROFILES, body);
      expect(refused.status).toBe(403);
      // In the owner's Personal workspace there is no agency to make it in.
      expect((await h.as(t.owner).post(PROFILES, body)).status).toBe(403);
      // A membership of another agency is the same 404 as one that never existed.
      const other = await team({ who: await investigator(), role: 'INVESTIGATOR' });
      expect(
        (await h.as(t.owner, t.tenantId).post(PROFILES, { membershipId: other.membershipOf(0) }))
          .status,
      ).toBe(404);

      await h
        .as(t.owner, t.tenantId)
        .post(`/agencies/current/members/${t.membershipOf(0)}/suspend`);
      expect((await h.as(t.owner, t.tenantId).post(PROFILES, body)).status).toBe(403);
      expect(
        await h.owner`SELECT 1 FROM investigator_profiles WHERE tenant_id = ${t.tenantId}`,
      ).toHaveLength(0);
    });
  });

  describe('managing it', () => {
    /** An agency with a viewer and an agent, and the profile it holds for the agent. */
    const held = async (legalName?: string) => {
      const agent = await investigator(legalName);
      const viewer = await h.signedIn();
      const t = await team({ who: agent, role: 'INVESTIGATOR' }, { who: viewer, role: 'VIEWER' });
      const res = await h
        .as(t.owner, t.tenantId)
        .post(PROFILES, { membershipId: t.membershipOf(0) });
      return { ...t, agent, viewer, profileId: res.body.id as string };
    };

    it('lets the agency write the storefront, and audits it as the agency’s change', async () => {
      const p = await held();
      const res = await h.as(p.owner, p.tenantId).patch(`${PROFILES}/${p.profileId}`, {
        headline: 'Corporate due diligence',
        pseudonym: `Ararat Desk ${lettersOf(p.profileId)}`,
        languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
        acceptingWork: true,
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        headline: 'Corporate due diligence',
        name: `Ararat Desk ${lettersOf(p.profileId)}`,
        languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
        acceptingWork: true,
      });
      expect(await audited('profile.updated', p.profileId)).toEqual([
        { reason: 'agency', actor_id: p.owner.actor.userId },
      ]);
      // The holder reads the same profile as their own, in the agency.
      const mine = await h.as(p.agent, p.tenantId).get('/profiles/investigator/me');
      expect(mine.body).toMatchObject({ id: p.profileId, headline: 'Corporate due diligence' });
    });

    it.each([
      ['the legal name', { displayName: 'Someone Else' }],
      ['whether customers see the legal name', { publicName: 'LEGAL' }],
    ])('does not let the agency write %s', async (_label, body) => {
      const p = await held();
      const res = await h.as(p.owner, p.tenantId).patch(`${PROFILES}/${p.profileId}`, body);
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([expect.objectContaining({ code: 'NOT_ALLOWED' })]);
    });

    it('ignores a name choice handed to the service in-process, where no pipe stands in the way', async () => {
      const p = await held();
      const service = h.app.get(AgencyInvestigatorsService);
      const saved = await runInContext(
        await agencyContext(h.owner, p.owner.actor.userId, p.tenantId),
        () =>
          service.update(
            p.owner.actor,
            p.profileId,
            { headline: 'Still saved', publicName: 'LEGAL' } as never,
            { correlationId: 'in-process' },
          ),
      );
      expect(saved).toMatchObject({ headline: 'Still saved', publicName: 'PSEUDONYM' });
    });

    it('checks a pseudonym against the holder’s legal name, not the writer’s', async () => {
      const p = await held('Anahit Sargsyan');
      const res = await h
        .as(p.owner, p.tenantId)
        .patch(`${PROFILES}/${p.profileId}`, { pseudonym: 'Anahit Investigations' });
      expect(res.status).toBe(422);
      expect(res.body.error.details).toEqual([expect.objectContaining({ code: 'OWN_NAME' })]);
    });

    it('lets a member holding only investigators.read look, not change', async () => {
      const p = await held();
      const one = await h.as(p.viewer, p.tenantId).get(`${PROFILES}/${p.profileId}`);
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({ id: p.profileId, membershipId: p.membershipOf(0) });
      expect(
        (await h.as(p.viewer, p.tenantId).patch(`${PROFILES}/${p.profileId}`, { headline: 'x' }))
          .status,
      ).toBe(403);
    });

    it('reaches no profile but its own: another agency’s and a Personal one are both 404', async () => {
      const p = await held();
      const other = await held();
      expect((await h.as(p.owner, p.tenantId).get(`${PROFILES}/${other.profileId}`)).status).toBe(
        404,
      );
      expect((await h.as(p.agent).post('/profiles/roles', { role: 'INVESTIGATOR' })).status).toBe(
        201,
      );
      const personal = await h.as(p.agent).get('/profiles/investigator/me');
      expect(
        (
          await h
            .as(p.owner, p.tenantId)
            .patch(`${PROFILES}/${personal.body.id}`, { headline: 'x' })
        ).status,
      ).toBe(404);
    });

    it('manages the profile’s service areas through the agency', async () => {
      const p = await held();
      const areas = `${PROFILES}/${p.profileId}/service-areas`;
      const created = await h.as(p.owner, p.tenantId).post(areas, {
        kind: 'RADIUS',
        label: 'Yerevan',
        centre: { lon: 44.51, lat: 40.18 },
        radiusKm: 15,
      });
      expect(created.status).toBe(201);
      expect((await h.as(p.viewer, p.tenantId).get(areas)).body).toHaveLength(1);
      expect((await h.as(p.owner, p.tenantId).delete(`${areas}/${created.body.id}`)).status).toBe(
        204,
      );
      expect((await h.as(p.owner, p.tenantId).get(areas)).body).toEqual([]);
    });
  });

  describe('the holder', () => {
    it('works with the agency’s profile in the agency and their own in their Personal workspace', async () => {
      const agent = await investigator();
      const t = await team({ who: agent, role: 'INVESTIGATOR' });
      const made = await h
        .as(t.owner, t.tenantId)
        .post(PROFILES, { membershipId: t.membershipOf(0) });
      // No Personal profile yet: their own route there finds nothing — not the agency's.
      expect((await h.as(agent).get('/profiles/investigator/me')).status).toBe(404);
      expect((await h.as(agent).post('/profiles/roles', { role: 'INVESTIGATOR' })).status).toBe(
        201,
      );

      const inAgency = await h.as(agent, t.tenantId).get('/profiles/investigator/me');
      const personal = await h.as(agent).get('/profiles/investigator/me');
      expect(inAgency.body.id).toBe(made.body.id);
      expect(personal.body.id).not.toBe(made.body.id);
      expect(inAgency.body.agency).toMatchObject({ id: t.tenantId });
      expect(personal.body.agency).toBeNull();
    });

    it('takes up a role only in their Personal workspace, so an agency gets no profile it did not make', async () => {
      const agent = await investigator();
      const t = await team({ who: agent, role: 'INVESTIGATOR' });
      const res = await h.as(agent, t.tenantId).post('/profiles/roles', { role: 'INVESTIGATOR' });
      expect(res.status).toBe(403);
      expect(
        await h.owner`SELECT 1 FROM investigator_profiles WHERE tenant_id = ${t.tenantId}`,
      ).toHaveLength(0);
    });

    it('cannot rename themself or choose their legal name from the agency, even holding investigators.update', async () => {
      const agent = await investigator();
      const t = await team({ who: agent, role: 'ADMIN' });
      await h.as(t.owner, t.tenantId).post(PROFILES, { membershipId: t.membershipOf(0) });
      const me = (body: object) => h.as(agent, t.tenantId).patch('/profiles/investigator/me', body);

      expect((await me({ displayName: 'Another Name' })).status).toBe(403);
      expect((await me({ publicName: 'LEGAL' })).status).toBe(403);
      // The rest of the form, the name unchanged, saves as it would anywhere.
      const saved = await me({ displayName: 'Test Agent', publicName: 'PSEUDONYM', headline: 'x' });
      expect(saved.status).toBe(200);
      expect(saved.body.headline).toBe('x');
      const [user] = await h.owner<{ display_name: string }[]>`
        SELECT display_name FROM users WHERE id = ${agent.actor.userId}`;
      expect(user!.display_name).toBe('Test Agent');
    });
  });

  describe('a holder who leaves', () => {
    it.each(['suspend', 'remove'])(
      'is withdrawn on %s, and cannot be offered again while away',
      async (how) => {
        const agent = await investigator();
        const t = await team({ who: agent, role: 'INVESTIGATOR' });
        const made = await h
          .as(t.owner, t.tenantId)
          .post(PROFILES, { membershipId: t.membershipOf(0) });
        await listable(made.body.id);

        const left = await h
          .as(t.owner, t.tenantId)
          .post(`/agencies/current/members/${t.membershipOf(0)}/${how}`);
        expect([200, 201, 204]).toContain(left.status);
        expect(await stored(made.body.id)).toMatchObject({
          visibility: 'DRAFT',
          accepting_work: false,
        });

        for (const body of [{ visibility: 'PUBLISHED' }, { acceptingWork: true }]) {
          const res = await h.as(t.owner, t.tenantId).patch(`${PROFILES}/${made.body.id}`, body);
          expect(res.status).toBe(409);
          expect(res.body.error.details).toEqual([
            expect.objectContaining({ code: 'HOLDER_INACTIVE' }),
          ]);
        }
        // The rest of the storefront can still be tended.
        expect(
          (await h.as(t.owner, t.tenantId).patch(`${PROFILES}/${made.body.id}`, { headline: 'x' }))
            .status,
        ).toBe(200);
        const listed = await h.as(t.owner, t.tenantId).get(`${PROFILES}/${made.body.id}`);
        expect(listed.body.holderStatus).toBe(how === 'suspend' ? 'SUSPENDED' : 'REMOVED');
      },
    );

    it('stays a draft when reactivated, until the agency publishes it again', async () => {
      const agent = await investigator();
      const t = await team({ who: agent, role: 'INVESTIGATOR' });
      const made = await h
        .as(t.owner, t.tenantId)
        .post(PROFILES, { membershipId: t.membershipOf(0) });
      await listable(made.body.id);
      const members = `/agencies/current/members/${t.membershipOf(0)}`;
      await h.as(t.owner, t.tenantId).post(`${members}/suspend`);
      await h.as(t.owner, t.tenantId).post(`${members}/reactivate`);
      expect((await stored(made.body.id)).visibility).toBe('DRAFT');
      const republished = await h
        .as(t.owner, t.tenantId)
        .patch(`${PROFILES}/${made.body.id}`, { visibility: 'PUBLISHED', acceptingWork: true });
      expect(republished.status).toBe(200);
      expect(republished.body).toMatchObject({ visibility: 'PUBLISHED', acceptingWork: true });
    });
  });
});
