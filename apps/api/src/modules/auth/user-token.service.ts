import { Injectable } from '@nestjs/common';
import { TokenService } from './token.service';

export type TokenPurpose = 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';

/**
 * Lifetimes differ because the threats differ. A verification link sits in an inbox and
 * is low value; a reset link is a live credential and its window is the window in which a
 * compromised mailbox can take the account over.
 */
export const TOKEN_TTL_MINUTES: Record<TokenPurpose, number> = {
  EMAIL_VERIFICATION: 24 * 60,
  PASSWORD_RESET: 60,
};

export interface IssuedUserToken {
  /** Sent to the address. Never stored, never logged, never audited. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

@Injectable()
export class UserTokenService {
  constructor(private readonly tokens: TokenService) {}

  issue(purpose: TokenPurpose, now = new Date()): IssuedUserToken {
    const token = this.tokens.issue();
    return {
      token,
      tokenHash: this.tokens.fingerprint(token),
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MINUTES[purpose] * 60 * 1000),
    };
  }

  fingerprint(token: string): string {
    return this.tokens.fingerprint(token);
  }

  /** Single use: a consumed token is dead regardless of how much life it had left. */
  isRedeemable(row: { expiresAt: Date; consumedAt: Date | null }, now = new Date()): boolean {
    if (row.consumedAt !== null) return false;
    return row.expiresAt > now;
  }
}
