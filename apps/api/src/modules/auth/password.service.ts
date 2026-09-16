import { hash, Algorithm, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

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

/**
 * A pre-computed hash of a value nobody knows, used to spend the same CPU on a
 * login for an address that does not exist. Without this, a failed login returns
 * measurably faster than a successful one and the timing leaks which emails are
 * registered — an enumeration oracle the response body alone cannot close.
 */
let decoyHash: string | undefined;

@Injectable()
export class PasswordService {
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
   * Call when no user was found. Spends comparable time to a real verification so
   * the two paths are not distinguishable by a stopwatch.
   */
  async verifyDecoy(plain: string): Promise<false> {
    decoyHash ??= await hash('decoy-value-never-a-real-password', OPTIONS);
    await this.verify(decoyHash, plain);
    return false;
  }
}
