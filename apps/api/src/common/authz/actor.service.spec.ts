import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { userRoles, users, userSessions, userStaffScopes } from '../../database/schema';
import { SessionService } from '../../modules/auth/session.service';
import { TokenService } from '../../modules/auth/token.service';
import { ActorService } from './actor.service';
import { testPool } from '../../../test/db';

describe('resolving the actor', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let actors: ActorService;
  let tokens: TokenService;
  let sessions: SessionService;

  beforeAll(() => {
    sql = testPool();
    db = drizzle(sql, { schema });
    tokens = new TokenService();
    sessions = new SessionService(tokens);
    actors = new ActorService(db, tokens, sessions);
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A user with the given roles and scopes, and a live session. Returns its token. */
  const seed = async (
    opts: {
      roles?: Array<'CUSTOMER' | 'INVESTIGATOR' | 'STAFF'>;
      scopes?: Array<'VERIFICATION' | 'MODERATION' | 'DISPUTES' | 'PAYMENTS'>;
      status?: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION' | 'DELETED';
    } = {},
  ): Promise<{ token: string; userId: string }> => {
    const [user] = await db
      .insert(users)
      .values({
        email: `actor-${randomUUID()}@example.test`,
        status: opts.status ?? 'ACTIVE',
      })
      .returning();
    const userId = user?.id ?? '';

    for (const role of opts.roles ?? ['CUSTOMER']) {
      await db.insert(userRoles).values({ userId, role });
    }
    for (const scope of opts.scopes ?? []) {
      await db.insert(userStaffScopes).values({ userId, scope });
    }

    const issued = sessions.create(userId);
    await db.insert(userSessions).values({
      id: issued.sessionId,
      userId,
      familyId: issued.familyId,
      refreshTokenHash: issued.refreshTokenHash,
      expiresAt: issued.expiresAt,
    });
    return { token: issued.refreshToken, userId };
  };

  describe('identity and status — checks 1 and 2', () => {
    it('resolves an active account', async () => {
      const { token, userId } = await seed();
      const actor = await actors.fromRefreshToken(token);
      expect(actor).toMatchObject({ userId, status: 'ACTIVE', roles: ['CUSTOMER'] });
    });

    it('carries the session id, so a mutation traces to one device', async () => {
      const { token } = await seed();
      const actor = await actors.fromRefreshToken(token);
      const row = await db.query.userSessions.findFirst({
        where: eq(userSessions.refreshTokenHash, tokens.fingerprint(token)),
      });
      expect(actor.sessionId).toBe(row?.id);
    });

    it('issues no actor for an unknown token', async () => {
      await expect(actors.fromRefreshToken('never-issued')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('issues no actor for an empty token', async () => {
      await expect(actors.fromRefreshToken('')).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('issues no actor for a revoked session', async () => {
      const { token, userId } = await seed();
      await db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.userId, userId));
      await expect(actors.fromRefreshToken(token)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('issues no actor for a suspended account', async () => {
      const { token } = await seed({ status: 'SUSPENDED' });
      await expect(actors.fromRefreshToken(token)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('issues no actor for a deleted account', async () => {
      const { token } = await seed({ status: 'DELETED' });
      await expect(actors.fromRefreshToken(token)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('still resolves an unverified account', async () => {
      // Not an enforcement state: login admits it, so the session stands. What such an
      // account may do is decided per action by AuthzService.requireActive.
      const { token } = await seed({ status: 'PENDING_VERIFICATION' });
      await expect(actors.fromRefreshToken(token)).resolves.toMatchObject({
        status: 'PENDING_VERIFICATION',
      });
    });

    it('issues no actor for a soft-deleted user', async () => {
      const { token, userId } = await seed();
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));
      await expect(actors.fromRefreshToken(token)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });
  });

  describe('roles and staff scopes are read per request', () => {
    it('reflects a role granted after the session began', async () => {
      const { token, userId } = await seed({ roles: ['CUSTOMER'] });
      await db.insert(userRoles).values({ userId, role: 'INVESTIGATOR' });
      const actor = await actors.fromRefreshToken(token);
      // No re-login required — the point of reading these per request.
      expect([...actor.roles].sort()).toEqual(['CUSTOMER', 'INVESTIGATOR']);
    });

    it('drops a revoked role on the very next request', async () => {
      const { token, userId } = await seed({ roles: ['CUSTOMER', 'INVESTIGATOR'] });
      await db.update(userRoles).set({ revokedAt: new Date() }).where(eq(userRoles.userId, userId));
      const actor = await actors.fromRefreshToken(token);
      expect(actor.roles).toEqual([]);
    });

    it('carries staff scopes for a staff account', async () => {
      const { token } = await seed({ roles: ['STAFF'], scopes: ['MODERATION', 'DISPUTES'] });
      const actor = await actors.fromRefreshToken(token);
      expect([...actor.staffScopes].sort()).toEqual(['DISPUTES', 'MODERATION']);
    });

    it('drops a revoked scope on the very next request', async () => {
      const { token, userId } = await seed({ roles: ['STAFF'], scopes: ['PAYMENTS'] });
      await db
        .update(userStaffScopes)
        .set({ revokedAt: new Date() })
        .where(eq(userStaffScopes.userId, userId));
      const actor = await actors.fromRefreshToken(token);
      expect(actor.staffScopes).toEqual([]);
    });

    it('reads no scopes for a non-staff account even if rows exist', async () => {
      // A stray row must never become authority.
      const { token, userId } = await seed({ roles: ['CUSTOMER'] });
      await db.insert(userStaffScopes).values({ userId, scope: 'PAYMENTS' });
      const actor = await actors.fromRefreshToken(token);
      expect(actor.staffScopes).toEqual([]);
    });
  });

  describe('role switching narrows, and cannot widen', () => {
    it('needs no new sign-in — the same token switches workspace', async () => {
      const { token } = await seed({ roles: ['CUSTOMER', 'INVESTIGATOR'] });
      const asCustomer = await actors.fromRefreshToken(token, 'CUSTOMER');
      const asInvestigator = await actors.fromRefreshToken(token, 'INVESTIGATOR');
      expect(asCustomer.activeRole).toBe('CUSTOMER');
      expect(asInvestigator.activeRole).toBe('INVESTIGATOR');
      expect(asCustomer.sessionId).toBe(asInvestigator.sessionId);
    });

    it('ignores a role the account does not hold', async () => {
      // Intersect, never union. Asking to be staff leaves the actor exactly where it was.
      const { token } = await seed({ roles: ['CUSTOMER'] });
      const actor = await actors.fromRefreshToken(token, 'STAFF');
      expect(actor.activeRole).toBeUndefined();
      expect(actor.roles).toEqual(['CUSTOMER']);
    });

    it('grants no staff scopes to someone asking to be staff', async () => {
      const { token } = await seed({ roles: ['CUSTOMER'] });
      const actor = await actors.fromRefreshToken(token, 'STAFF');
      expect(actor.staffScopes).toEqual([]);
    });

    it('ignores an unrecognised role string', async () => {
      const { token } = await seed({ roles: ['CUSTOMER'] });
      const actor = await actors.fromRefreshToken(token, 'SUPERUSER');
      expect(actor.activeRole).toBeUndefined();
    });

    it('leaves the actor unnarrowed when no role is requested', async () => {
      const { token } = await seed({ roles: ['CUSTOMER', 'INVESTIGATOR'] });
      const actor = await actors.fromRefreshToken(token);
      expect(actor.activeRole).toBeUndefined();
    });
  });

  it('is frozen, so nothing downstream can widen it', async () => {
    const { token } = await seed({ roles: ['CUSTOMER'] });
    const actor = await actors.fromRefreshToken(token);
    // An Actor a service can edit is not a security boundary.
    expect(Object.isFrozen(actor)).toBe(true);
    expect(() => {
      // Deliberately writing to a readonly field: the freeze, not the type, is under test.
      (actor as unknown as { roles: string[] }).roles = ['STAFF'];
    }).toThrow();
  });
});
