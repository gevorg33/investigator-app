import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TokenService } from './token.service';

export interface SessionRecord {
  id: string;
  userId: string;
  familyId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface IssuedSession {
  userId: string;
  sessionId: string;
  familyId: string;
  refreshToken: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

export const REFRESH_TTL_DAYS = 30;

/**
 * Refresh-token rotation with reuse detection.
 *
 * Every refresh issues a new token and revokes the old one. Presenting a token that
 * was already rotated means it was captured — the legitimate holder would have the
 * newer one. That revokes the entire family rather than the single session, because
 * the attacker may already hold a descendant.
 */
@Injectable()
export class SessionService {
  constructor(private readonly tokens: TokenService) {}

  // familyId typed explicitly: randomUUID() returns a template-literal type, so
  // inferring from the default rejects a plain string on rotation.
  create(userId: string, familyId: string = randomUUID()): IssuedSession {
    const refreshToken = this.tokens.issue();
    return {
      userId,
      sessionId: randomUUID(),
      familyId,
      refreshToken,
      refreshTokenHash: this.tokens.fingerprint(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    };
  }

  /** Rotation keeps the family, so reuse anywhere in the chain is detectable. */
  rotate(previous: SessionRecord): IssuedSession {
    return this.create(previous.userId, previous.familyId);
  }

  isUsable(s: SessionRecord, now = new Date()): boolean {
    // Revocation is checked on every use, which is what makes it immediate rather
    // than effective at next expiry (T-005).
    if (s.revokedAt !== null) return false;
    return s.expiresAt > now;
  }

  /**
   * A presented token that matches a session already revoked by rotation is reuse.
   * Distinguished from an ordinary expired session, which is not an attack.
   */
  isReuse(s: SessionRecord, now = new Date()): boolean {
    return s.revokedAt !== null && s.expiresAt > now;
  }
}
