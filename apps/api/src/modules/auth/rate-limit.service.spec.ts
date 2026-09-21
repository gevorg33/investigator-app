import { describe, expect, it } from 'vitest';
import { atTime } from '../../../test/time';
import { LIMITS, MemoryRateLimitStore, RateLimitService } from './rate-limit.service';

describe('rate limiting', () => {
  it('allows up to the limit then refuses', async () => {
    const svc = new RateLimitService(new MemoryRateLimitStore());
    for (let i = 0; i < LIMITS.loginPerAccount.max; i++) {
      await expect(svc.consume('loginPerAccount', 'acct')).resolves.toBeUndefined();
    }
    await expect(svc.consume('loginPerAccount', 'acct')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('lets the same caller back in once the window has passed', async () => {
    // The window was never exercised: the store's `resetAt <= now` branch counted as covered
    // because the `||` in front of it short-circuits, so a limiter that never reset would have
    // passed every test here and locked people out permanently (T-042).
    const svc = new RateLimitService(new MemoryRateLimitStore());
    await atTime('2026-03-01T12:00:00.000Z', async (clock) => {
      for (let i = 0; i < LIMITS.loginPerAccount.max; i++) {
        await svc.consume('loginPerAccount', 'acct');
      }
      await expect(svc.consume('loginPerAccount', 'acct')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });

      clock.advance((LIMITS.loginPerAccount.windowSeconds + 1) * 1000);
      await expect(svc.consume('loginPerAccount', 'acct')).resolves.toBeUndefined();
    });
  });

  it('counts per identifier — one account does not exhaust another', async () => {
    const svc = new RateLimitService(new MemoryRateLimitStore());
    for (let i = 0; i < LIMITS.loginPerAccount.max; i++) await svc.consume('loginPerAccount', 'a');
    await expect(svc.consume('loginPerAccount', 'b')).resolves.toBeUndefined();
  });

  it('limits per IP as well as per account', async () => {
    // Per-account alone lets one password be sprayed across many accounts.
    const svc = new RateLimitService(new MemoryRateLimitStore());
    for (let i = 0; i < LIMITS.loginPerIp.max; i++) await svc.consume('loginPerIp', '1.2.3.4');
    await expect(svc.consume('loginPerIp', '1.2.3.4')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });

  it('covers register and reset, not only login', async () => {
    for (const scope of ['registerPerIp', 'resetPerAccount', 'resetPerIp'] as const) {
      expect(LIMITS[scope].max).toBeGreaterThan(0);
      expect(LIMITS[scope].windowSeconds).toBeGreaterThan(0);
    }
  });
});
