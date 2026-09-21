import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import * as schema from '../../database/schema';
import { auditLogs, tenants, userSessions } from '../../database/schema';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { MemoryRateLimitStore, RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';
import { testPool } from '../../../test/db';
import { scopedDb } from '../../../test/workspace-context';
import { runAsUser } from '../../common/context/execution-context';


describe('auth end to end', () => {
  let sql: postgres.Sql;
  // Sign-in and recovery happen outside any workspace, so their entries belong to none — and
  // the application sees only its own workspace's rows (T-080). The owner is who reads them.
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let auth: AuthService;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const email = () => `probe-${randomUUID()}@example.test`;
  const PASSWORD = 'a-sufficiently-long-password';
  // A distinct IP per test. The per-IP register limit is 5/hour and it applies here
  // exactly as it would in production — sharing one address across cases exhausts it,
  // which is the limiter working rather than a test problem.
  let ipCounter = 0;
  const newCtx = () => ({
    ip: `198.51.100.${++ipCounter}`,
    userAgent: 'vitest',
    // Unique per context: spec files run in parallel against one database, so any
    // assertion over the audit log has to be scoped to the rows this case produced.
    correlationId: randomUUID(),
  });

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ max: 1, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const tokens = new TokenService();
    auth = new AuthService(
      db,
      new PasswordService(),
      tokens,
      new SessionService(tokens),
      // Fresh store per suite so limits from one test do not exhaust another.
      new RateLimitService(new MemoryRateLimitStore()),
      new AuditService(db),
      new UserTokenService(tokens),
      // Registration now mails a verification link; these cases assert on auth, not on
      // delivery. recovery.integration.spec.ts captures the mail and follows the link.
      { send: async () => undefined },
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  it('registers and then logs in', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const r = await auth.login(e, PASSWORD, ctx);
    expect(r.userId).toBeTruthy();
    expect(r.refreshToken).toBeTruthy();
  });

  it('opens every session in the Personal workspace registration created, through rotation too', async () => {
    // T-074. Registration runs as investigator_app, so this also proves the trigger that makes
    // the workspace works with the runtime role's privileges, not only the owner's.
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const first = await auth.login(e, PASSWORD, ctx);

    // Read as the user alone, the way login reads it: before a session names a workspace, that
    // is all the application may see (T-077).
    const [personal] = await runAsUser(first.userId, async () => {
      const rows = await db.select().from(tenants).where(eq(tenants.personalOwnerId, first.userId));
      return rows;
    });
    expect(personal).toMatchObject({ kind: 'PERSONAL', status: 'ACTIVE', name: null });

    const sessionFor = (token: string) =>
      db.query.userSessions.findFirst({
        where: eq(userSessions.refreshTokenHash, new TokenService().fingerprint(token)),
      });
    expect((await sessionFor(first.refreshToken))?.defaultTenantId).toBe(personal!.id);

    const second = await auth.refresh(first.refreshToken, ctx);
    expect((await sessionFor(second.refreshToken))?.defaultTenantId).toBe(personal!.id);
  });

  it('never stores the password in the clear', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const row = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain(PASSWORD);
  });

  it('never stores the refresh token in the clear', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const { refreshToken } = await auth.login(e, PASSWORD, ctx);
    const rows = await db.select().from(userSessions);
    expect(rows.some((r) => r.refreshTokenHash === refreshToken)).toBe(false);
  });

  it('gives the same opaque error for a wrong password and an unknown account', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const wrong = await auth.login(e, 'wrong-password-entirely', ctx).catch((x: Error) => x);
    const unknown = await auth.login(email(), PASSWORD, ctx).catch((x: Error) => x);
    // Identical to the caller — the difference is only in the audit log.
    expect((wrong as { code?: string }).code).toBe('UNAUTHENTICATED');
    expect((unknown as { code?: string }).code).toBe('UNAUTHENTICATED');
  });

  it('rotates the refresh token, invalidating the previous one', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const first = await auth.login(e, PASSWORD, ctx);
    const second = await auth.refresh(first.refreshToken, ctx);
    expect(second.refreshToken).not.toBe(first.refreshToken);
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const first = await auth.login(e, PASSWORD, ctx);
    const second = await auth.refresh(first.refreshToken, ctx);

    // Replaying the already-rotated token: the legitimate holder would have the
    // newer one, so this was captured.
    await expect(auth.refresh(first.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });

    // The descendant the attacker might also hold must now be dead too.
    await expect(auth.refresh(second.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a revoked session immediately, not at next expiry', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const s = await auth.login(e, PASSWORD, ctx);
    await auth.revoke(s.refreshToken, ctx);
    // A stateless JWT would still validate here — this is why tokens are opaque.
    await expect(auth.refresh(s.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('audits register, login, failure and reuse detection', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const s = await auth.login(e, PASSWORD, ctx);
    await auth.login(e, 'wrong-password-entirely', ctx).catch(() => undefined);
    await auth.refresh(s.refreshToken, ctx);
    await auth.refresh(s.refreshToken, ctx).catch(() => undefined);

    const rows = await ownerDb.select().from(auditLogs);
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'auth.register',
      'auth.login',
      'auth.login.failed',
      'auth.refresh',
      'auth.refresh.reuse_detected',
    ]) {
      expect(actions).toContain(a);
    }
  });

  it('writes no secret into the audit log', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const s = await auth.login(e, PASSWORD, ctx);
    const rows = await ownerDb.select().from(auditLogs);
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(PASSWORD);
    expect(blob).not.toContain(s.refreshToken);
  });

  it('does not reveal that an address is already registered', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    // Second registration must resolve identically, not throw a conflict.
    await expect(auth.register(e, 'another-long-password', ctx)).resolves.toBeUndefined();
    // And must not have overwritten the original credential.
    await expect(auth.login(e, PASSWORD, ctx)).resolves.toMatchObject({
      userId: expect.any(String),
    });
  });

  it('refuses a suspended account, and records the real reason only in the audit log', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    await db.update(schema.users).set({ status: 'SUSPENDED' }).where(eq(schema.users.email, e));

    // The password is correct; suspension is what rejects it.
    const err = await auth.login(e, PASSWORD, ctx).catch((x: Error) => x);
    expect((err as { code?: string }).code).toBe('UNAUTHENTICATED');

    const row = await db.query.users.findFirst({ where: eq(schema.users.email, e) });
    const entries = await ownerDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, row?.id ?? ''));
    const reasons = entries.filter((x) => x.action === 'auth.login.failed').map((x) => x.reason);
    expect(reasons).toContain('suspended');
    // Distinguishable internally, indistinguishable to the caller.
    expect(reasons).not.toContain('bad_password');
  });

  it('rejects a refresh token that matches no session', async () => {
    const ctx = newCtx();
    await expect(auth.refresh('a-token-that-was-never-issued', ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an expired session without treating it as an attack', async () => {
    const ctx = newCtx();
    const e = email();
    await auth.register(e, PASSWORD, ctx);
    const s = await auth.login(e, PASSWORD, ctx);

    // Expire it in place: expiry is an ordinary end of life, not token reuse.
    await db
      .update(userSessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(userSessions.refreshTokenHash, new TokenService().fingerprint(s.refreshToken)));

    await expect(auth.refresh(s.refreshToken, ctx)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const entries = await ownerDb.select().from(auditLogs);
    expect(entries.filter((x) => x.action === 'auth.refresh.reuse_detected')).not.toContainEqual(
      expect.objectContaining({ actorId: s.userId }),
    );
  });

  it('ignores a logout for a token that matches no session', async () => {
    const ctx = newCtx();
    // Must not throw: a stale cookie on logout is routine, not an error.
    await expect(auth.revoke('a-token-that-was-never-issued', ctx)).resolves.toBeUndefined();
    const mine = await ownerDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.correlationId, ctx.correlationId));
    expect(mine).toHaveLength(0);
  });

  it('is usable when the request carries no ip or user agent', async () => {
    // Every context field is optional; a missing one must not become the string
    // "undefined" in a rate-limit key or a session row.
    const bare = { correlationId: 'test-correlation' };
    const e = email();
    await auth.register(e, PASSWORD, bare);
    const s = await auth.login(e, PASSWORD, bare);

    const row = await db.query.userSessions.findFirst({
      where: eq(userSessions.refreshTokenHash, new TokenService().fingerprint(s.refreshToken)),
    });
    expect(row?.ipAddress).toBeNull();
    expect(row?.userAgent).toBeNull();

    // Rotation writes a second session row, so it has to tolerate the bare context too.
    const rotated = await auth.refresh(s.refreshToken, bare);
    const next = await db.query.userSessions.findFirst({
      where: eq(userSessions.refreshTokenHash, new TokenService().fingerprint(rotated.refreshToken)),
    });
    expect(next?.ipAddress).toBeNull();
    expect(next?.userAgent).toBeNull();
  });
});
