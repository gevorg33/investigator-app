import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/** DI token — an interface does not exist at runtime, so Nest cannot inject one. */
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export interface RateLimitStore {
  incr(key: string, windowSeconds: number): Promise<number>;
}

/** In-memory fallback. Redis-backed in production — a per-instance counter is not a limit. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, { n: number; resetAt: number }>();

  async incr(key: string, windowSeconds: number): Promise<number> {
    const now = Date.now();
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { n: 1, resetAt: now + windowSeconds * 1000 });
      return 1;
    }
    cur.n += 1;
    return cur.n;
  }
}

export const LIMITS = {
  // Per account: slows credential stuffing against one target.
  loginPerAccount: { max: 5, windowSeconds: 300 },
  // Per IP: slows spraying across many accounts, which the per-account limit misses.
  loginPerIp: { max: 20, windowSeconds: 300 },
  registerPerIp: { max: 5, windowSeconds: 3600 },
  resetPerAccount: { max: 3, windowSeconds: 3600 },
  resetPerIp: { max: 10, windowSeconds: 3600 },
  // Each authorization issues a signature and a row. Provisional; generous enough for a
  // multi-page licence scan, tight enough that the endpoint is not a way to fill storage.
  mediaUploadPerAccount: { max: 30, windowSeconds: 3600 },
  // Every submission is read by a moderator, and that queue is the publication gate.
  // Provisional: generous for a customer with genuine work in several places, tight enough
  // that one account cannot flood the queue faster than people can read it.
  missionSubmitPerAccount: { max: 10, windowSeconds: 86_400 },
} as const;

/**
 * Both dimensions are needed. A per-account limit alone lets an attacker try one
 * password against ten thousand accounts; a per-IP limit alone lets a botnet target
 * one account from many addresses.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async consume(scope: keyof typeof LIMITS, identifier: string): Promise<void> {
    const { max, windowSeconds } = LIMITS[scope];
    // The account dimension is keyed by a hash, so the limiter never stores an
    // address in a key that ends up in logs or metrics.
    const n = await this.store.incr(`rl:${scope}:${identifier}`, windowSeconds);
    if (n > max) throw new AppError(ErrorCode.RATE_LIMITED);
  }
}
