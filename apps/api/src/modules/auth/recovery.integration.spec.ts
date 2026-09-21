import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import type { MailMessage } from '../../common/mail/mailer';
import * as schema from '../../database/schema';
import { auditLogs, userSessions, userTokens } from '../../database/schema';
import { AuthService } from './auth.service';
import { SessionRepository } from './session.repository';
import { AuthzService } from '../../common/authz/authz.service';
import { PasswordService } from './password.service';
import { MemoryRateLimitStore, RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';
import { ActorService } from '../../common/authz/actor.service';
import { testPool } from '../../../test/db';
import { scopedDb } from '../../../test/workspace-context';


/** Captures what would have been mailed, so the link can be followed in a test. */
class CapturingMailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe('verification and password reset', () => {
  let sql: postgres.Sql;
  // Sign-in and recovery happen outside any workspace, so their entries belong to none — and
  // the application sees only its own workspace's rows (T-080). The owner is who reads them.
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let auth: AuthService;
  let mailer: CapturingMailer;
  let actors: ActorService;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const email = () => `recovery-${randomUUID()}@example.test`;
  const PASSWORD = 'a-sufficiently-long-password';
  const NEW_PASSWORD = 'an-entirely-different-password';
  let ipCounter = 0;
  const newCtx = () => ({
    ip: `203.0.113.${++ipCounter}`,
    userAgent: 'vitest',
    correlationId: 'test-correlation',
  });

  /** The token as the recipient would get it: out of the link, not out of the database. */
  const linkToken = (n = -1): string => {
    const msg = mailer.sent.at(n);
    return new URL(msg?.variables['url'] ?? '').searchParams.get('token') ?? '';
  };

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ max: 1, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const tokens = new TokenService();
    mailer = new CapturingMailer();
    // The real resolution path, so these exercise the guard's behaviour rather than a
    // hand-built Actor that could drift from what a request actually produces.
    actors = new ActorService(db, tokens, new SessionService(tokens));
    auth = new AuthService(
      db,
      new PasswordService(),
      tokens,
      new SessionService(tokens),
      new RateLimitService(new MemoryRateLimitStore()),
      new AuditService(db),
      new UserTokenService(tokens),
      mailer,
      new SessionRepository(db),
      new AuthzService(new AuditService(db)),
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  describe('email verification', () => {
    it('mails a link on registration and activates the account when redeemed', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);

      expect(mailer.sent.at(-1)).toMatchObject({ to: e, template: 'email_verification' });
      const before = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
      expect(before?.status).toBe('PENDING_VERIFICATION');
      expect(before?.emailVerifiedAt).toBeNull();

      await auth.verifyEmail(linkToken(), ctx);

      const after = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
      expect(after?.status).toBe('ACTIVE');
      expect(after?.emailVerifiedAt).not.toBeNull();
    });

    it('refuses the same token twice', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const token = linkToken();
      await auth.verifyEmail(token, ctx);
      await expect(auth.verifyEmail(token, ctx)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('refuses an expired token', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const token = linkToken();
      await db
        .update(userTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(userTokens.tokenHash, new TokenService().fingerprint(token)));

      await expect(auth.verifyEmail(token, ctx)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('will not reactivate a suspended account', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const token = linkToken();
      await db
        .update(schema.users)
        .set({ status: 'SUSPENDED' })
        .where(eq(schema.users.email, e));

      await auth.verifyEmail(token, ctx);

      const row = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
      // The token is spent, but suspension stands.
      expect(row?.status).toBe('SUSPENDED');
    });

    it('invalidates the previous link when a new one is sent', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const first = linkToken();
      await auth.requestEmailVerification(e, ctx);
      const second = linkToken();

      expect(second).not.toBe(first);
      await expect(auth.verifyEmail(first, ctx)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      await expect(auth.verifyEmail(second, ctx)).resolves.toBeUndefined();
    });

    it('stays silent for an unknown address', async () => {
      const ctx = newCtx();
      const before = mailer.sent.length;
      await expect(auth.requestEmailVerification(email(), ctx)).resolves.toBeUndefined();
      expect(mailer.sent.length).toBe(before);
    });
  });

  describe('password reset', () => {
    it('answers identically for a registered and an unknown address', async () => {
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      await expect(auth.requestPasswordReset(e, newCtx())).resolves.toBeUndefined();
      await expect(auth.requestPasswordReset(email(), newCtx())).resolves.toBeUndefined();
    });

    it('sets the new password and refuses the old one', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      await auth.requestPasswordReset(e, newCtx());
      await auth.resetPassword(linkToken(), NEW_PASSWORD, ctx);

      await expect(auth.login(e, NEW_PASSWORD, newCtx())).resolves.toMatchObject({
        userId: expect.any(String),
      });
      await expect(auth.login(e, PASSWORD, newCtx())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('revokes every existing session', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      const b = await auth.login(e, PASSWORD, newCtx());

      await auth.requestPasswordReset(e, newCtx());
      await auth.resetPassword(linkToken(), NEW_PASSWORD, ctx);

      // The reason for the revocation: whoever forced the reset may be holding these.
      for (const s of [a, b]) {
        await expect(auth.refresh(s.refreshToken, newCtx())).rejects.toMatchObject({
          code: 'UNAUTHENTICATED',
        });
      }
    });

    it('refuses the same reset token twice', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      await auth.requestPasswordReset(e, newCtx());
      const token = linkToken();
      await auth.resetPassword(token, NEW_PASSWORD, ctx);
      await expect(auth.resetPassword(token, 'yet-another-long-password', ctx)).rejects.toMatchObject(
        { code: 'UNAUTHENTICATED' },
      );
    });

    it('will not accept a verification token at the reset endpoint', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      // Purpose is part of the lookup, so the two kinds are not interchangeable.
      await expect(auth.resetPassword(linkToken(), NEW_PASSWORD, ctx)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('refuses an unknown token', async () => {
      await expect(
        auth.resetPassword('a-token-that-was-never-issued', NEW_PASSWORD, newCtx()),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('never puts the token in the audit log', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      await auth.requestPasswordReset(e, newCtx());
      const token = linkToken();
      await auth.resetPassword(token, NEW_PASSWORD, ctx);

      const blob = JSON.stringify(await ownerDb.select().from(auditLogs));
      expect(blob).not.toContain(token);
      expect(blob).not.toContain(NEW_PASSWORD);
    });

    it('stores only a hash of the token', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const token = linkToken();
      const rows = await db.select().from(userTokens);
      expect(rows.some((r) => r.tokenHash === token)).toBe(false);
    });
  });

  describe('session management', () => {
    it('lists the caller’s own sessions and marks the current one', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      await auth.login(e, PASSWORD, newCtx());

      const sessions = await auth.listSessions(await actors.fromRefreshToken(a.refreshToken), ctx);
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
    });

    it('never returns a token or a hash', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      const actor = await actors.fromRefreshToken(a.refreshToken);
      const blob = JSON.stringify(await auth.listSessions(actor, ctx));
      expect(blob).not.toContain(a.refreshToken);
      expect(blob).not.toContain(new TokenService().fingerprint(a.refreshToken));
    });

    it('revokes a named session, and that session stops working at once', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      const b = await auth.login(e, PASSWORD, newCtx());

      const actor = await actors.fromRefreshToken(a.refreshToken);
      const other = (await auth.listSessions(actor, ctx)).find((s) => !s.current);
      await auth.revokeSession(actor, other?.id ?? '', ctx);

      await expect(auth.refresh(b.refreshToken, newCtx())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      // The caller's own session is untouched.
      await expect(auth.refresh(a.refreshToken, newCtx())).resolves.toMatchObject({
        userId: expect.any(String),
      });
    });

    it('refuses to revoke a session belonging to somebody else', async () => {
      const mine = email();
      const theirs = email();
      await auth.register(mine, PASSWORD, newCtx());
      await auth.register(theirs, PASSWORD, newCtx());
      const a = await auth.login(mine, PASSWORD, newCtx());
      const victim = await auth.login(theirs, PASSWORD, newCtx());

      const victimRow = await db.query.userSessions.findFirst({
        where: eq(userSessions.refreshTokenHash, new TokenService().fingerprint(victim.refreshToken)),
      });

      // IDOR: a valid session id, but not one of mine. 404, never 403 — a 403 would
      // confirm the id is real to someone who should not know it exists.
      const mineActor = await actors.fromRefreshToken(a.refreshToken);
      await expect(
        auth.revokeSession(mineActor, victimRow?.id ?? '', newCtx()),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      // Still alive.
      await expect(auth.refresh(victim.refreshToken, newCtx())).resolves.toMatchObject({
        userId: expect.any(String),
      });
    });

    it('rejects listing with a revoked session', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      await auth.revoke(a.refreshToken, ctx);
      // Rejected at resolution: a revoked session yields no Actor at all.
      await expect(actors.fromRefreshToken(a.refreshToken)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });
  });

  describe('requests that carry no ip', () => {
    // Every context field is optional. A missing ip must not become the string
    // "undefined" in a rate-limit key, silently sharing one bucket between callers.
    const bare = { correlationId: 'test-correlation' };

    it('accepts a reset request', async () => {
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      await expect(auth.requestPasswordReset(e, bare)).resolves.toBeUndefined();
      expect(mailer.sent.at(-1)).toMatchObject({ to: e, template: 'password_reset' });
    });

    it('accepts a verification resend', async () => {
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      await expect(auth.requestEmailVerification(e, bare)).resolves.toBeUndefined();
      expect(mailer.sent.at(-1)).toMatchObject({ to: e, template: 'email_verification' });
    });
  });

  it('refuses a verification token that matches no row', async () => {
    await expect(
      auth.verifyEmail('a-token-that-was-never-issued', newCtx()),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });

    const reasons = (await ownerDb.select().from(auditLogs))
      .filter((x) => x.action === 'auth.verification.failed')
      .map((x) => x.reason);
    // Distinguished in the audit log from a token that existed and was spent.
    expect(reasons).toContain('token_unknown');
  });

  describe('suspension ends existing sessions, not just new logins', () => {
    const suspend = async (e: string): Promise<void> => {
      await db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.email, e));
    };

    it('refuses to refresh a session belonging to a suspended account', async () => {
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      const s = await auth.login(e, PASSWORD, newCtx());
      await suspend(e);

      // Before this was checked, suspension blocked the next login and nothing else: the
      // session kept rotating for up to REFRESH_TTL_DAYS. An enforcement action that
      // leaves the offender working for thirty days is not an enforcement action.
      await expect(auth.refresh(s.refreshToken, newCtx())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('refuses to list sessions for a suspended account', async () => {
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      const s = await auth.login(e, PASSWORD, newCtx());
      await suspend(e);
      // No Actor is issued for a suspended account, so nothing downstream has to remember
      // to check again.
      await expect(actors.fromRefreshToken(s.refreshToken)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('revokes every session rather than merely refusing this one', async () => {
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      const a = await auth.login(e, PASSWORD, newCtx());
      const b = await auth.login(e, PASSWORD, newCtx());
      await suspend(e);

      await expect(auth.refresh(a.refreshToken, newCtx())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      // The untouched session is dead too: refusing per call site has to be repeated
      // correctly everywhere, whereas revoking ends it once.
      const rows = await db
        .select()
        .from(userSessions)
        .where(eq(userSessions.userId, a.userId));
      expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
      await expect(auth.refresh(b.refreshToken, newCtx())).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
    });

    it('audits the termination with the reason', async () => {
      const e = email();
      const ctx = newCtx();
      await auth.register(e, PASSWORD, newCtx());
      const s = await auth.login(e, PASSWORD, newCtx());
      await suspend(e);
      await auth.refresh(s.refreshToken, ctx).catch(() => undefined);

      const rows = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, ctx.correlationId));
      expect(rows.map((r) => r.action)).toContain('auth.session.terminated');
      expect(rows.map((r) => r.reason)).toContain('account_suspended');
    });

    it('ends the session of a soft-deleted account whose status still reads ACTIVE', async () => {
      // Soft delete does not change `status`, so checking status alone would leave an
      // erased account's sessions rotating until they expired.
      const e = email();
      const ctx = newCtx();
      await auth.register(e, PASSWORD, newCtx());
      const s = await auth.login(e, PASSWORD, newCtx());
      await db
        .update(schema.users)
        .set({ status: 'ACTIVE', deletedAt: new Date() })
        .where(eq(schema.users.email, e));

      await expect(auth.refresh(s.refreshToken, ctx)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      const rows = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, ctx.correlationId));
      expect(rows.map((r) => r.reason)).toContain('account_deleted');
    });

    it('lets an unverified account keep its session', async () => {
      // PENDING_VERIFICATION is not an enforcement state. Login admits it, so severing the
      // session on the first rotation would sign people out for no reason; whether an
      // unverified account may do a given thing is a per-feature gate.
      const e = email();
      await auth.register(e, PASSWORD, newCtx());
      const s = await auth.login(e, PASSWORD, newCtx());
      const row = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
      expect(row?.status).toBe('PENDING_VERIFICATION');
      await expect(auth.refresh(s.refreshToken, newCtx())).resolves.toMatchObject({
        userId: expect.any(String),
      });
    });
  });
});
