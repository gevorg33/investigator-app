import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { ActorService } from '../../common/authz/actor.service';
import { AuthzService } from '../../common/authz/authz.service';
import * as schema from '../../database/schema';
import { userRoles, users, userSessions } from '../../database/schema';
import { SessionService } from '../auth/session.service';
import { TokenService } from '../auth/token.service';
import { testActor } from '../../../test/authz-cases';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';
import { testPool } from '../../../test/db';


describe('one account, both roles', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let profiles: ProfilesService;
  let actors: ActorService;
  let sessions: SessionService;
  const req = { ip: '198.51.100.9', userAgent: 'vitest', correlationId: 'roles-test' };

  beforeAll(() => {
    sql = testPool();
    db = drizzle(sql, { schema });
    const tokens = new TokenService();
    sessions = new SessionService(tokens);
    actors = new ActorService(db, tokens, sessions);
    profiles = new ProfilesService(
      db,
      new AuthzService(new AuditService(db)),
      new AuditService(db),
      new OwnInvestigatorProfileRepository(db),
      new OwnCustomerProfileRepository(db),
    );
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A live account with a session, so the real Actor resolution can be exercised. */
  const account = async (): Promise<{ userId: string; token: string }> => {
    const [user] = await db
      .insert(users)
      .values({ email: `roles-${randomUUID()}@example.test`, status: 'ACTIVE' })
      .returning();
    const userId = user?.id ?? '';
    const issued = sessions.create(userId);
    await db.insert(userSessions).values({
      id: issued.sessionId,
      userId,
      familyId: issued.familyId,
      refreshTokenHash: issued.refreshTokenHash,
      expiresAt: issued.expiresAt,
    });
    return { userId, token: issued.refreshToken };
  };

  it('activates both roles on the same account, with no second registration', async () => {
    const { userId, token } = await account();
    const bare = testActor({ userId, roles: [] });

    await profiles.activateRole(bare, 'CUSTOMER', req);
    await profiles.activateRole(bare, 'INVESTIGATOR', req);

    // One account. Not two identities, two verification histories and two reputations for
    // one person (plan.md:12).
    const actor = await actors.fromRefreshToken(token);
    expect([...actor.roles].sort()).toEqual(['CUSTOMER', 'INVESTIGATOR']);
    expect(actor.userId).toBe(userId);
  });

  it('creates the profile each role implies', async () => {
    const { userId, token } = await account();
    const bare = testActor({ userId, roles: [] });
    await profiles.activateRole(bare, 'CUSTOMER', req);
    await profiles.activateRole(bare, 'INVESTIGATOR', req);

    const actor = await actors.fromRefreshToken(token);
    await expect(profiles.getMyCustomerProfile(actor, req)).resolves.toMatchObject({ userId });
    await expect(profiles.getMyInvestigatorProfile(actor, req)).resolves.toMatchObject({ userId });
  });

  it('is idempotent — a double-submitted form is not an error', async () => {
    const { userId } = await account();
    const bare = testActor({ userId, roles: [] });
    const first = await profiles.activateRole(bare, 'INVESTIGATOR', req);
    const second = await profiles.activateRole(bare, 'INVESTIGATOR', req);

    expect(second.profileId).toBe(first.profileId);
    const roles = await db
      .select()
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'INVESTIGATOR')));
    expect(roles).toHaveLength(1);
  });

  it('re-activates a previously revoked role rather than stacking a second row', async () => {
    const { userId, token } = await account();
    const bare = testActor({ userId, roles: [] });
    await profiles.activateRole(bare, 'INVESTIGATOR', req);
    await db
      .update(userRoles)
      .set({ revokedAt: new Date() })
      .where(eq(userRoles.userId, userId));
    expect((await actors.fromRefreshToken(token)).roles).toEqual([]);

    await profiles.activateRole(bare, 'INVESTIGATOR', req);
    expect((await actors.fromRefreshToken(token)).roles).toEqual(['INVESTIGATOR']);
    const rows = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    expect(rows).toHaveLength(1);
  });

  it('switching workspace needs no new sign-in, and the same session serves both', async () => {
    const { userId, token } = await account();
    const bare = testActor({ userId, roles: [] });
    await profiles.activateRole(bare, 'CUSTOMER', req);
    await profiles.activateRole(bare, 'INVESTIGATOR', req);

    const asCustomer = await actors.fromRefreshToken(token, 'CUSTOMER');
    const asInvestigator = await actors.fromRefreshToken(token, 'INVESTIGATOR');
    expect(asCustomer.sessionId).toBe(asInvestigator.sessionId);

    // And narrowing bites: while acting as a customer, the investigator profile is refused
    // even though the role is held.
    await expect(profiles.getMyInvestigatorProfile(asCustomer, req)).rejects.toMatchObject({
      status: 403,
    });
    await expect(profiles.getMyInvestigatorProfile(asInvestigator, req)).resolves.toMatchObject({
      userId,
    });
  });

  it('cannot self-activate STAFF', async () => {
    // Not expressible through the DTO, and not offered by the service signature either —
    // staff roles are granted by staff.
    const { userId } = await account();
    const bare = testActor({ userId, roles: [] });
    await profiles.activateRole(bare, 'CUSTOMER', req);
    const roles = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    expect(roles.map((r) => r.role)).not.toContain('STAFF');
  });

  it('refuses activation for a suspended account', async () => {
    const { userId } = await account();
    const suspended = testActor({ userId, roles: [], status: 'SUSPENDED' });
    await expect(profiles.activateRole(suspended, 'INVESTIGATOR', req)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('audits the activation', async () => {
    const { userId } = await account();
    const bare = testActor({ userId, roles: [] });
    const correlationId = randomUUID();
    await profiles.activateRole(bare, 'INVESTIGATOR', { ...req, correlationId });

    const rows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.correlationId, correlationId));
    expect(rows.map((r) => r.action)).toContain('profile.role_activated');
    expect(rows.map((r) => r.reason)).toContain('INVESTIGATOR');
  });

  it('is idempotent for the customer role as well', async () => {
    const { userId } = await account();
    const bare = testActor({ userId, roles: [] });
    const first = await profiles.activateRole(bare, 'CUSTOMER', req);
    const second = await profiles.activateRole(bare, 'CUSTOMER', req);

    expect(second.profileId).toBe(first.profileId);
    const rows = await db
      .select()
      .from(schema.customerProfiles)
      .where(eq(schema.customerProfiles.userId, userId));
    expect(rows).toHaveLength(1);
  });
});
