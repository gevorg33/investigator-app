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
import { PasswordService } from './password.service';
import { MemoryRateLimitStore, RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

/** Captures what would have been mailed, so the link can be followed in a test. */
class CapturingMailer {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

describe('verification and password reset', () => {
  let sql: postgres.Sql;
  let auth: AuthService;
  let mailer: CapturingMailer;
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
    return new globalThis.URL(msg?.variables['url'] ?? '').searchParams.get('token') ?? '';
  };

  beforeAll(() => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
    const tokens = new TokenService();
    mailer = new CapturingMailer();
    auth = new AuthService(
      db,
      new PasswordService(),
      tokens,
      new SessionService(tokens),
      new RateLimitService(new MemoryRateLimitStore()),
      new AuditService(db),
      new UserTokenService(tokens),
      mailer,
    );
  });

  afterAll(async () => {
    await sql.end();
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

      const blob = JSON.stringify(await db.select().from(auditLogs));
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

      const sessions = await auth.listSessions(a.refreshToken, ctx);
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
    });

    it('never returns a token or a hash', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      const blob = JSON.stringify(await auth.listSessions(a.refreshToken, ctx));
      expect(blob).not.toContain(a.refreshToken);
      expect(blob).not.toContain(new TokenService().fingerprint(a.refreshToken));
    });

    it('revokes a named session, and that session stops working at once', async () => {
      const ctx = newCtx();
      const e = email();
      await auth.register(e, PASSWORD, ctx);
      const a = await auth.login(e, PASSWORD, newCtx());
      const b = await auth.login(e, PASSWORD, newCtx());

      const other = (await auth.listSessions(a.refreshToken, ctx)).find((s) => !s.current);
      await auth.revokeSession(a.refreshToken, other?.id ?? '', ctx);

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

      // IDOR: a valid session id, but not one of mine.
      await expect(auth.revokeSession(a.refreshToken, victimRow?.id ?? '', newCtx())).rejects.toMatchObject(
        { code: 'UNAUTHENTICATED' },
      );
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
      await expect(auth.listSessions(a.refreshToken, ctx)).rejects.toMatchObject({
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

    const reasons = (await db.select().from(auditLogs))
      .filter((x) => x.action === 'auth.verification.failed')
      .map((x) => x.reason);
    // Distinguished in the audit log from a token that existed and was spent.
    expect(reasons).toContain('token_unknown');
  });
});
