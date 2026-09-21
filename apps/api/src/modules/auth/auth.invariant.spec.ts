import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { MemoryRateLimitStore, RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';

/**
 * Registration depends on INSERT ... RETURNING yielding the row it just wrote. That
 * always holds against Postgres, so it cannot be provoked through the database — but the
 * consequence of handling it quietly is bad enough to be worth pinning down: an account
 * that exists, was never audited, and can never be verified because no link was sent.
 */
describe('registration invariants', () => {
  const build = (returning: unknown[]) => {
    const audit = { record: vi.fn().mockResolvedValue(undefined) };
    const mailer = { send: vi.fn().mockResolvedValue(undefined) };
    const db: Record<string, unknown> = {
      query: { users: { findFirst: vi.fn().mockResolvedValue(undefined) } },
      insert: () => ({ values: () => ({ returning: async () => returning }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    // Registration writes the account and its consent rows in one transaction (T-022), so the
    // stub has to be able to open one — it hands the same stub back.
    db['transaction'] = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
    const tokens = new TokenService();
    const service = new AuthService(
      db as never,
      new PasswordService(),
      tokens,
      new SessionService(tokens),
      new RateLimitService(new MemoryRateLimitStore()),
      audit as never,
      new UserTokenService(tokens),
      mailer as never,
      {} as never,
      {} as never,
      // Nothing is published in this suite, so the gate has nothing to require.
      { requireAcceptance: vi.fn().mockResolvedValue(undefined) } as never,
    );
    return { service, audit, mailer };
  };

  const ctx = { ip: '198.51.100.200', userAgent: 'vitest', correlationId: 'test' };
  const PASSWORD = 'a-sufficiently-long-password';

  it('fails loudly when the insert returns no row', async () => {
    const { service } = build([]);
    await expect(service.register('probe@example.test', PASSWORD, ctx)).rejects.toThrow(
      /returned no row/,
    );
  });

  it('sends no verification mail when the insert returned nothing', async () => {
    // The failure that matters: a silent skip here is an account nobody can activate.
    const { service, mailer } = build([]);
    await service.register('probe@example.test', PASSWORD, ctx).catch(() => undefined);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('audits and mails on the normal path', async () => {
    const { service, audit, mailer } = build([{ id: 'u1', email: 'probe@example.test' }]);
    await service.register('probe@example.test', PASSWORD, ctx);
    // The account and its consent rows commit together now, so the audit entry is written
    // inside that transaction and carries it (T-022).
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.register', actorId: 'u1' }),
      expect.anything(),
    );
    expect(mailer.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'probe@example.test', template: 'email_verification' }),
    );
  });
});
