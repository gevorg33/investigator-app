import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { employeesApp } from '../../../../test/employees-harness';
import { TokenService } from '../../auth/token.service';
import { INVITATION_TTL_DAYS } from './invitations.service';

/**
 * Invitations into an agency over HTTP (T-085): sent, resent, cancelled, accepted, expired — and
 * accepted only by the account the invitation was sent to, with that address confirmed.
 */
describe('agency invitations', () => {
  let h: Awaited<ReturnType<typeof employeesApp>>;

  beforeAll(async () => {
    h = await employeesApp();
  });

  afterAll(async () => {
    await h.close();
  });

  const INVITATIONS = '/agencies/current/invitations';
  type Person = Awaited<ReturnType<typeof h.signedIn>>;

  const agencyWith = async (...roles: string[]) => {
    const people: Person[] = [];
    for (let i = 0; i <= roles.length; i++) people.push(await h.signedIn());
    const { tenantId, memberships } = await h.agencyOf(
      people.map((who, i) => ({ who, ...(i > 0 && { role: roles[i - 1] }) })),
    );
    return { tenantId, memberships, owner: people[0]!, others: people.slice(1) };
  };

  const invite = (by: Person, tenantId: string, email: string, role = 'INVESTIGATOR') =>
    h.as(by, tenantId).post(INVITATIONS, { email, role });

  const accept = (who: Person, token: string) => h.as(who).post('/invitations/accept', { token });

  describe('inviting', () => {
    it('stores a hash, mails a link with the agency’s name, and lists it as pending', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const res = await invite(a.owner, a.tenantId, invitee.email);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        email: invitee.email,
        role: 'INVESTIGATOR',
        status: 'PENDING',
        sentCount: 1,
        acceptedAt: null,
      });
      const days = (Date.parse(res.body.expiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(INVITATION_TTL_DAYS - 0.01);

      const mail = h.mails.at(-1)!;
      expect(mail).toMatchObject({ to: invitee.email, template: 'workspace_invitation' });
      const [agency] = await h.owner<
        { name: string }[]
      >`SELECT name FROM tenants WHERE id = ${a.tenantId}`;
      expect(mail.variables['workspace']).toBe(agency!.name);
      expect(mail.variables['url']).toMatch(/^http:\/\/app\.test\/invitations\/accept\?token=/);

      const token = h.tokenFor(invitee.email);
      const [row] = await h.owner<{ token_hash: string }[]>`
        SELECT token_hash FROM tenant_invitations WHERE id = ${res.body.id}`;
      expect(row!.token_hash).not.toContain(token);
      expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
      const [audit] = await h.owner<{ reason: string }[]>`
        SELECT reason FROM audit_logs WHERE action = 'employees.invited' AND resource_id = ${res.body.id}`;
      // The role, never the address.
      expect(audit!.reason).toBe('INVESTIGATOR');

      const list = await h.as(a.owner, a.tenantId).get(INVITATIONS);
      expect(list.body).toEqual([expect.objectContaining({ id: res.body.id, status: 'PENDING' })]);
    });

    it('links to the local app when no base address is configured', async () => {
      const a = await agencyWith();
      const saved = process.env['APP_BASE_URL'];
      delete process.env['APP_BASE_URL'];
      try {
        const email = `local-${randomUUID()}@example.test`;
        expect((await invite(a.owner, a.tenantId, email)).status).toBe(201);
        expect(h.mails.at(-1)!.variables['url']).toMatch(
          /^http:\/\/localhost:3000\/invitations\/accept\?token=/,
        );
      } finally {
        process.env['APP_BASE_URL'] = saved;
      }
    });

    it('refuses an unknown role, and a role above the inviter’s own', async () => {
      const a = await agencyWith('ADMIN');
      const unknown = await invite(a.owner, a.tenantId, `u-${randomUUID()}@example.test`, 'GOD');
      expect(unknown.status).toBe(422);
      expect(unknown.body.error.details[0]).toMatchObject({
        field: 'role',
        messageKey: 'error.validation.employees.role_unknown',
      });
      const upward = await invite(
        a.others[0]!,
        a.tenantId,
        `u-${randomUUID()}@example.test`,
        'OWNER',
      );
      expect(upward.status).toBe(403);
      const peer = await invite(
        a.others[0]!,
        a.tenantId,
        `u-${randomUUID()}@example.test`,
        'ADMIN',
      );
      expect(peer.status).toBe(201);
    });

    it('is not for a member who cannot invite, nor for a Personal workspace', async () => {
      const a = await agencyWith('MANAGER');
      expect(
        (await invite(a.others[0]!, a.tenantId, `u-${randomUUID()}@example.test`)).status,
      ).toBe(403);
      expect(
        (await h.as(a.owner).post(INVITATIONS, { email: 'x@example.test', role: 'VIEWER' })).status,
      ).toBe(403);
    });

    it('refuses an address that is already a member, or already has a live invitation', async () => {
      const a = await agencyWith('VIEWER');
      const member = await invite(a.owner, a.tenantId, a.others[0]!.email.toUpperCase());
      expect(member.status).toBe(409);
      expect(member.body.error.details[0].messageKey).toBe(
        'error.validation.employees.already_member',
      );
      const email = `twice-${randomUUID()}@example.test`;
      await invite(a.owner, a.tenantId, email);
      const again = await invite(a.owner, a.tenantId, email);
      expect(again.status).toBe(409);
      expect(again.body.error.details[0].messageKey).toBe(
        'error.validation.employees.already_invited',
      );
    });

    it('replaces an expired invitation with a new one, and lists the old as expired then cancelled', async () => {
      const a = await agencyWith();
      const email = `late-${randomUUID()}@example.test`;
      const first = await invite(a.owner, a.tenantId, email);
      await h.owner`UPDATE tenant_invitations SET expires_at = now() - interval '1 minute' WHERE id = ${first.body.id}`;
      const listed = await h.as(a.owner, a.tenantId).get(INVITATIONS);
      expect(listed.body[0]).toMatchObject({ id: first.body.id, status: 'EXPIRED' });
      const second = await invite(a.owner, a.tenantId, email);
      expect(second.status).toBe(201);
      const statuses = (await h.as(a.owner, a.tenantId).get(INVITATIONS)).body.map(
        (i: { id: string; status: string }) => [i.id, i.status],
      );
      expect(statuses).toEqual([
        [second.body.id, 'PENDING'],
        [first.body.id, 'CANCELLED'],
      ]);
    });

    it('limits how many a workspace may send in an hour, resends included', async () => {
      const a = await agencyWith();
      const sent = [];
      for (let i = 0; i < 20; i++) {
        sent.push(
          (await invite(a.owner, a.tenantId, `bulk-${i}-${randomUUID()}@example.test`)).status,
        );
      }
      expect(new Set(sent)).toEqual(new Set([201]));
      const over = await invite(a.owner, a.tenantId, `bulk-${randomUUID()}@example.test`);
      expect(over.status).toBe(429);
    });
  });

  describe('accepting', () => {
    it('makes the invited account a member with the invitation’s role, usable on its next request', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const sent = await invite(a.owner, a.tenantId, invitee.email, 'MANAGER');
      expect((await h.as(invitee, a.tenantId).get('/agencies/current/members')).status).toBe(403);

      const res = await accept(invitee, h.tokenFor(invitee.email));
      expect(res.status).toBe(200);
      const [agency] = await h.owner<
        { name: string }[]
      >`SELECT name FROM tenants WHERE id = ${a.tenantId}`;
      expect(res.body).toEqual({ workspaceId: a.tenantId, name: agency!.name });

      const members = await h.as(invitee, a.tenantId).get('/agencies/current/members');
      expect(members.status).toBe(200);
      expect(members.body.find((m: { you: boolean }) => m.you).roles).toEqual(['MANAGER']);
      const [row] = await h.owner<{ status: string; accepted_by: string }[]>`
        SELECT status, accepted_by FROM tenant_invitations WHERE id = ${sent.body.id}`;
      expect(row).toEqual({ status: 'ACCEPTED', accepted_by: invitee.actor.userId });
      const [audit] = await h.owner<{ actor_id: string }[]>`
        SELECT actor_id FROM audit_logs
         WHERE action = 'employees.invitation_accepted' AND resource_id = ${sent.body.id}`;
      expect(audit!.actor_id).toBe(invitee.actor.userId);
    });

    it('works once: the same link a second time finds nothing', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      await invite(a.owner, a.tenantId, invitee.email);
      const token = h.tokenFor(invitee.email);
      expect((await accept(invitee, token)).status).toBe(200);
      expect((await accept(invitee, token)).status).toBe(404);
    });

    it('cannot be accepted by a different account — not a stranger, not the agency’s own owner', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const sent = await invite(a.owner, a.tenantId, invitee.email);
      const token = h.tokenFor(invitee.email);
      const stranger = await h.signedIn();
      expect((await accept(stranger, token)).status).toBe(404);
      // In the agency's own workspace its owner can see the invitation, and still cannot use it.
      const inside = await h.as(a.owner, a.tenantId).post('/invitations/accept', { token });
      expect(inside.status).toBe(404);
      const [row] = await h.owner<{ status: string }[]>`
        SELECT status FROM tenant_invitations WHERE id = ${sent.body.id}`;
      expect(row!.status).toBe('PENDING');
      // The right account still can.
      expect((await accept(invitee, token)).status).toBe(200);
    });

    it('needs the address confirmed — and an active account', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      await invite(a.owner, a.tenantId, invitee.email);
      const token = h.tokenFor(invitee.email);
      await h.owner`UPDATE users SET email_verified_at = NULL WHERE id = ${invitee.actor.userId}`;
      expect((await accept(invitee, token)).status).toBe(404);
      await h.owner`UPDATE users SET status = 'PENDING_VERIFICATION' WHERE id = ${invitee.actor.userId}`;
      expect((await accept(invitee, token)).status).toBe(403);
    });

    it('is refused once expired, and for a token nobody issued', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const sent = await invite(a.owner, a.tenantId, invitee.email);
      await h.owner`UPDATE tenant_invitations SET expires_at = now() - interval '1 second' WHERE id = ${sent.body.id}`;
      expect((await accept(invitee, h.tokenFor(invitee.email))).status).toBe(404);
      expect((await accept(invitee, 'n'.repeat(43))).status).toBe(404);
    });

    it('brings a removed member back — the same membership, with the new invitation’s role only', async () => {
      const a = await agencyWith('ADMIN');
      const person = a.others[0]!;
      await h.as(a.owner, a.tenantId).post(`/agencies/current/members/${a.memberships[1]}/remove`);
      await invite(a.owner, a.tenantId, person.email, 'VIEWER');
      expect((await accept(person, h.tokenFor(person.email))).status).toBe(200);
      const [row] = await h.owner<{ id: string; status: string }[]>`
        SELECT id, status FROM tenant_memberships WHERE tenant_id = ${a.tenantId} AND user_id = ${person.actor.userId}`;
      expect(row).toEqual({ id: a.memberships[1], status: 'ACTIVE' });
      const me = (await h.as(person, a.tenantId).get('/agencies/current/members')).body.find(
        (m: { you: boolean }) => m.you,
      );
      expect(me.roles).toEqual(['VIEWER']);
    });

    it('does not let a suspended member back in, nor an active one join twice', async () => {
      const a = await agencyWith('VIEWER', 'VIEWER');
      const [suspended, active] = a.others as [Person, Person];
      await h.as(a.owner, a.tenantId).post(`/agencies/current/members/${a.memberships[1]}/suspend`);
      // Invitations for existing members, written directly: inviting refuses them already.
      for (const who of [suspended, active]) {
        const token = randomUUID() + randomUUID();
        await h.owner`
          INSERT INTO tenant_invitations (tenant_id, email, role_id, token_hash, expires_at, invited_by)
          SELECT ${a.tenantId}, ${who.email}, id, ${new TokenService().fingerprint(token)},
                 now() + interval '1 day', ${a.owner.actor.userId}
            FROM roles WHERE key = 'ADMIN' AND tenant_id IS NULL`;
        const res = await accept(who, token);
        expect(res.status).toBe(409);
        expect(res.body.error.details[0].messageKey).toBe(
          who === suspended
            ? 'error.validation.employees.suspended'
            : 'error.validation.employees.already_member',
        );
      }
      expect((await h.as(suspended, a.tenantId).get('/agencies/current/members')).status).toBe(403);
    });
  });

  describe('resending and cancelling', () => {
    it('resends with a new link — the old one stops working, the new one works', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const sent = await invite(a.owner, a.tenantId, invitee.email);
      const old = h.tokenFor(invitee.email);
      const res = await h.as(a.owner, a.tenantId).post(`${INVITATIONS}/${sent.body.id}/resend`);
      expect(res.status).toBe(200);
      expect(res.body.sentCount).toBe(2);
      const fresh = h.tokenFor(invitee.email);
      expect(fresh).not.toBe(old);
      expect((await accept(invitee, old)).status).toBe(404);
      expect((await accept(invitee, fresh)).status).toBe(200);
    });

    it('resends an expired invitation with a new week', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const sent = await invite(a.owner, a.tenantId, invitee.email);
      await h.owner`UPDATE tenant_invitations SET expires_at = now() - interval '1 day' WHERE id = ${sent.body.id}`;
      const res = await h.as(a.owner, a.tenantId).post(`${INVITATIONS}/${sent.body.id}/resend`);
      expect(res.body.status).toBe('PENDING');
      expect((await accept(invitee, h.tokenFor(invitee.email))).status).toBe(200);
    });

    it('does not let an admin resend an owner’s invitation for a role above theirs', async () => {
      const a = await agencyWith('ADMIN');
      const sent = await invite(a.owner, a.tenantId, `o-${randomUUID()}@example.test`, 'OWNER');
      const res = await h
        .as(a.others[0]!, a.tenantId)
        .post(`${INVITATIONS}/${sent.body.id}/resend`);
      expect(res.status).toBe(403);
    });

    it('cancels: the link stops working, and a finished invitation cannot be resent or cancelled', async () => {
      const a = await agencyWith();
      const invitee = await h.signedIn();
      const sent = await invite(a.owner, a.tenantId, invitee.email);
      const token = h.tokenFor(invitee.email);
      const res = await h.as(a.owner, a.tenantId).post(`${INVITATIONS}/${sent.body.id}/cancel`);
      expect(res.body.status).toBe('CANCELLED');
      expect((await accept(invitee, token)).status).toBe(404);
      for (const action of ['resend', 'cancel']) {
        expect(
          (await h.as(a.owner, a.tenantId).post(`${INVITATIONS}/${sent.body.id}/${action}`)).status,
        ).toBe(403);
      }
    });

    it('does not reach another agency’s invitation', async () => {
      const a = await agencyWith();
      const b = await agencyWith();
      const theirs = await invite(b.owner, b.tenantId, `b-${randomUUID()}@example.test`);
      const res = await h.as(a.owner, a.tenantId).post(`${INVITATIONS}/${theirs.body.id}/cancel`);
      expect(res.status).toBe(404);
      expect((await h.as(a.owner, a.tenantId).get(INVITATIONS)).body).toEqual([]);
    });
  });
});
