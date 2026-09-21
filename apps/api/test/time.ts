import { vi } from 'vitest';

/** Moves the frozen clock forward, for code that reads it more than once. */
export interface FrozenClock {
  advance: (ms: number) => void;
  now: () => Date;
}

/**
 * Runs `fn` with the wall clock stopped at `at` (T-042).
 *
 * The convention this supports is injection, not faking: anything that decides whether
 * something has expired takes `now` as a parameter — `isExpired(expiresAt, now = new Date())`,
 * `isUsable(session, now = new Date())` — and its tests pass the moment they mean. That is
 * clearer than a global clock and it survives concurrency, so it stays the first choice.
 *
 * This is for the rest: code that reads the clock in the middle of doing something else and
 * has no seam to pass a date through, such as the login rate limiter's sliding window.
 *
 * **Only `Date` is faked.** Faking timers as well would stop `setTimeout`, and with it the
 * connection pool's keep-alive, supertest's sockets and every `await` that depends on one —
 * tests would hang rather than fail, which is the worse outcome.
 */
export async function atTime<T>(
  at: Date | string,
  fn: (clock: FrozenClock) => Promise<T> | T,
): Promise<T> {
  vi.useFakeTimers({ now: new Date(at), toFake: ['Date'] });
  try {
    return await fn({
      advance: (ms) => vi.setSystemTime(Date.now() + ms),
      now: () => new Date(),
    });
  } finally {
    vi.useRealTimers();
  }
}
