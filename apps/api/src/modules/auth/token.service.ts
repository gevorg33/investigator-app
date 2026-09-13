import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/**
 * Opaque tokens, not JWTs.
 *
 * T-005 requires that a revoked session is rejected immediately rather than at next
 * expiry. A stateless JWT cannot do that — it is valid until it expires, by design.
 * An opaque token checked against the sessions table can be revoked the instant the
 * row changes.
 */
@Injectable()
export class TokenService {
  /** 256 bits of entropy. Returned to the client once and never stored in the clear. */
  issue(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * SHA-256 rather than argon2: the token is already high-entropy random, so there is
   * nothing to brute-force and a slow hash would only add latency to every request.
   * Passwords are the opposite case — see PasswordService.
   */
  fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Constant-time compare, so a mismatch position cannot be probed by timing. */
  matches(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
