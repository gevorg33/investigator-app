import { hash, Algorithm, verify } from '@node-rs/argon2';
import { Injectable, type OnModuleInit } from '@nestjs/common';

/**
 * argon2id — memory-hard, so GPU cracking gains far less than against bcrypt.
 *
 * Parameters follow OWASP's minimum for argon2id: 19 MiB, 2 iterations,
 * parallelism 1. Raising memory is the strongest lever; raise it if login latency
 * budget allows.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // KiB — 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/** A value nobody knows. Its hash is the decoy; nothing ever verifies true against it. */
const DECOY_VALUE = 'decoy-value-never-a-real-password';

@Injectable()
export class PasswordService implements OnModuleInit {
  /**
   * A hash of {@link DECOY_VALUE}, used to spend the same CPU on a login for an address that does
   * not exist. Without it, a failed login returns measurably faster than a successful one and the
   * timing leaks which emails are registered — an enumeration oracle the response body alone
   * cannot close.
   *
   * Made at startup, never on first use (T-129). Made lazily, the first such login in each process
   * paid for a hash **and** a verification — about twice a real one — and that one response said
   * the address was not registered.
   */
  private decoyHash: string | undefined;

  /**
   * Nest awaits this before the application listens, so the decoy exists before the first request
   * — and an application that cannot make it does not start.
   */
  async onModuleInit(): Promise<void> {
    this.decoyHash = await this.hash(DECOY_VALUE);
  }

  async hash(plain: string): Promise<string> {
    return hash(plain, OPTIONS);
  }

  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain, OPTIONS);
    } catch {
      // A malformed stored hash must fail closed, not throw into the request.
      return false;
    }
  }

  /**
   * Call when no user was found. Spends one verification — what a wrong password for a real
   * account costs — so the two paths are not distinguishable by a stopwatch.
   *
   * Throws rather than computing the decoy late: a service used before `onModuleInit` is a wiring
   * mistake, and a late decoy is the oracle this exists to close.
   */
  async verifyDecoy(plain: string): Promise<false> {
    if (this.decoyHash === undefined) {
      throw new Error('PasswordService used before onModuleInit: no decoy hash');
    }
    await this.verify(this.decoyHash, plain);
    return false;
  }
}
