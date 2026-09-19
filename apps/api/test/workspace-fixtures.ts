import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import type { Actor, Role } from '../src/common/authz/contract';
import { testActor } from './authz-cases';

/**
 * A signed-in user: the user (whose Personal workspace the trigger makes) and a session row, so
 * the resolver has a session default to read. Written as the owner, like every fixture (T-073).
 */
export async function member(
  owner: postgres.Sql,
  opts: { roles?: Role[] } = {},
): Promise<{ actor: Actor; personalId: string }> {
  const [user] = await owner<{ id: string }[]>`
    INSERT INTO users (email, status) VALUES (${`ws-${randomUUID()}@example.test`}, 'ACTIVE') RETURNING id`;
  const [session] = await owner<{ id: string }[]>`
    INSERT INTO user_sessions (user_id, refresh_token_hash, family_id, expires_at)
    VALUES (${user!.id}, ${randomUUID()}, ${randomUUID()}, now() + interval '1 day') RETURNING id`;
  const [personal] = await owner<{ id: string }[]>`
    SELECT id FROM tenants WHERE personal_owner_id = ${user!.id}`;
  return {
    actor: testActor({ userId: user!.id, sessionId: session!.id, roles: opts.roles ?? ['CUSTOMER'] }),
    personalId: personal!.id,
  };
}

/**
 * An ACTIVE agency: the first member OWNER, the rest with the role given (VIEWER by default).
 * Committed in one transaction, which the owner rule requires.
 */
export async function agency(
  owner: postgres.Sql,
  members: Array<{ userId: string; role?: string }>,
): Promise<{ tenantId: string; memberships: string[] }> {
  return owner.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      INSERT INTO tenants (kind, status, name) VALUES ('AGENCY', 'ACTIVE', ${`Agency ${randomUUID().slice(0, 6)}`})
      RETURNING id`;
    const memberships: string[] = [];
    for (const [i, m] of members.entries()) {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id)
        VALUES (${t!.id}, 'AGENCY', ${m.userId}) RETURNING id`;
      memberships.push(row!.id);
      await tx`
        INSERT INTO membership_roles (membership_id, role_id)
        SELECT ${row!.id}, id FROM roles
         WHERE key = ${i === 0 ? 'OWNER' : (m.role ?? 'VIEWER')} AND tenant_id IS NULL`;
    }
    return { tenantId: t!.id, memberships };
  });
}
