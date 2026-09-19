import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { users, userSessions } from '../../database/schema';
import { expectAuthorized, testActor } from '../../../test/authz-cases';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { testPool } from '../../../test/db';


describe('actor-scoped reads', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repo: SessionRepository;
  let authz: AuthzService;
  let sessions: SessionService;

  beforeAll(() => {
    sql = testPool();
    db = drizzle(sql, { schema });
    repo = new SessionRepository(db);
    authz = new AuthzService(new AuditService(db));
    sessions = new SessionService(new TokenService());
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A user with one live session. Returns the Actor and that session's id. */
  const seed = async (): Promise<{ actor: Actor; sessionId: string }> => {
    const [user] = await db
      .insert(users)
      .values({ email: `repo-${randomUUID()}@example.test`, status: 'ACTIVE' })
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
    return { actor: testActor({ userId, sessionId: issued.sessionId }), sessionId: issued.sessionId };
  };

  it('returns a row to the actor it belongs to', async () => {
    const { actor, sessionId } = await seed();
    await expect(repo.findOneForActor(actor, sessionId)).resolves.toMatchObject({ id: sessionId });
  });

  it('returns nothing for another actor, rather than the row', async () => {
    const mine = await seed();
    const theirs = await seed();
    // The point of the pattern: the row never leaves the database, so there is no
    // forgotten comparison that could let it through.
    await expect(repo.findOneForActor(theirs.actor, mine.sessionId)).resolves.toBeUndefined();
  });

  it('returns nothing for an id that does not exist', async () => {
    const { actor } = await seed();
    await expect(repo.findOneForActor(actor, randomUUID())).resolves.toBeUndefined();
  });

  it('answers identically for "not yours" and "does not exist"', async () => {
    const mine = await seed();
    const theirs = await seed();
    const notMine = await repo.findOneForActor(theirs.actor, mine.sessionId);
    const missing = await repo.findOneForActor(theirs.actor, randomUUID());
    // Any difference here is an oracle for confirming that an id is real.
    expect(notMine).toBe(missing);
  });

  it('excludes revoked rows from the scope entirely', async () => {
    const { actor, sessionId } = await seed();
    await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
    await expect(repo.findOneForActor(actor, sessionId)).resolves.toBeUndefined();
  });

  it('lists only the actor’s own rows', async () => {
    const mine = await seed();
    await seed();
    const rows = await repo.findAllForActor(mine.actor);
    expect(rows.every((r) => r.userId === mine.actor.userId)).toBe(true);
    expect(rows).toHaveLength(1);
  });

  describe('the seven authorization cases', () => {
    it('passes the two that apply to a session', async () => {
      const mine = await seed();
      const theirs = await seed();

      // Sessions are not role-gated or state-gated, so those cases do not apply here and
      // are deliberately omitted rather than faked. The two that always apply do.
      await expectAuthorized(
        async (actor) =>
          authz.visible(actor, await repo.findOneForActor(actor, mine.sessionId), {
            action: 'session.revoke',
            resourceType: 'session',
            resourceId: mine.sessionId,
          }),
        { owner: mine.actor, otherOfSameRole: theirs.actor },
      );
    });
  });
});
