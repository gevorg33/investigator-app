import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { MAILER, type Mailer } from '../../common/mail/mailer';
import { DB, type Db } from '../../database/database.module';
import { userSessions, userTokens, users } from '../../database/schema';
import { invalidCredentials } from './auth.errors';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService, type TokenPurpose } from './user-token.service';
import { SessionRepository } from './session.repository';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId?: string | undefined;
}

export interface AuthResult {
  userId: string;
  refreshToken: string;
}

/**
 * Statuses that end a session immediately rather than at its next expiry.
 *
 * PENDING_VERIFICATION is deliberately absent. Login already admits an unverified account,
 * so refusing it here would sign people out the moment their first token rotated; whether
 * an unverified account may perform a given action is a per-feature gate
 * (AuthzService.requireActive), not a reason to sever the session.
 *
 * SUSPENDED and DELETED are different in kind. Suspension is an enforcement action, and an
 * enforcement action that leaves the offender working for up to REFRESH_TTL_DAYS is not an
 * enforcement action.
 */
const SESSION_ENDING_STATUSES = ['SUSPENDED', 'DELETED'] as const;

export interface SessionSummary {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  /** True for the session making the request, so a UI can label it rather than guess. */
  current: boolean;
}

/** Hashed so the rate-limit key never carries an address into logs or metrics. */
const accountKey = (email: string): string =>
  createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32);

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly limits: RateLimitService,
    private readonly audit: AuditService,
    private readonly userTokens: UserTokenService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly sessionRepo: SessionRepository,
    private readonly authz: AuthzService,
  ) {}

  async register(email: string, password: string, ctx: RequestContext): Promise<void> {
    await this.limits.consume('registerPerIp', ctx.ip ?? 'unknown');

    const passwordHash = await this.passwords.hash(password);
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, email) });

    if (existing) {
      // Deliberately silent. Telling the caller the address is taken enumerates
      // registered users; the real signal goes to the owner by email instead.
      await this.audit.record({
        ...ctx,
        action: 'auth.register.duplicate',
        resourceType: 'user',
        resourceId: existing.id,
      });
      return;
    }

    const [created] = await this.db.insert(users).values({ email, passwordHash }).returning();
    // RETURNING on a single-row insert always yields the row, so this is an invariant
    // rather than a case. It throws instead of skipping: carrying on would leave an
    // account that exists, was never audited, and has no way to verify itself.
    if (!created) throw new Error('user insert returned no row');

    await this.audit.record({
      ...ctx,
      actorId: created.id,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: created.id,
    });

    await this.issueToken(created.id, 'EMAIL_VERIFICATION', created.email, ctx);
  }

  /**
   * Re-sends a verification link. Silent for an unknown or already-verified address, for
   * the same reason register is: the response must not distinguish them.
   */
  async requestEmailVerification(email: string, ctx: RequestContext): Promise<void> {
    await this.limits.consume('resetPerIp', ctx.ip ?? 'unknown');
    await this.limits.consume('resetPerAccount', accountKey(email));

    const user = await this.db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
    });
    if (!user || user.emailVerifiedAt !== null) return;

    await this.issueToken(user.id, 'EMAIL_VERIFICATION', user.email, ctx);
  }

  async login(email: string, password: string, ctx: RequestContext): Promise<AuthResult> {
    await this.limits.consume('loginPerIp', ctx.ip ?? 'unknown');
    await this.limits.consume('loginPerAccount', accountKey(email));

    const user = await this.db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
    });

    // Spend the same CPU whether or not the account exists, or the timing tells an
    // attacker which addresses are registered.
    if (!user?.passwordHash) {
      await this.passwords.verifyDecoy(password);
      await this.audit.record({
        ...ctx,
        action: 'auth.login.failed',
        resourceType: 'user',
        reason: 'no_account',
      });
      throw invalidCredentials();
    }

    const ok = await this.passwords.verify(user.passwordHash, password);
    if (!ok || user.status === 'SUSPENDED') {
      await this.audit.record({
        ...ctx,
        actorId: user.id,
        action: 'auth.login.failed',
        resourceType: 'user',
        resourceId: user.id,
        // The real reason is recorded here; the caller gets one opaque error.
        reason: ok ? 'suspended' : 'bad_password',
      });
      throw invalidCredentials();
    }

    const issued = this.sessions.create(user.id);
    await this.db.insert(userSessions).values({
      id: issued.sessionId,
      userId: user.id,
      familyId: issued.familyId,
      refreshTokenHash: issued.refreshTokenHash,
      expiresAt: issued.expiresAt,
      ipAddress: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    await this.audit.record({
      ...ctx,
      actorId: user.id,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: issued.sessionId,
    });

    return { userId: user.id, refreshToken: issued.refreshToken };
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<AuthResult> {
    const hash = this.tokens.fingerprint(refreshToken);
    const found = await this.db.query.userSessions.findFirst({
      where: eq(userSessions.refreshTokenHash, hash),
    });

    if (!found) throw invalidCredentials();

    if (this.sessions.isReuse(found)) {
      // A token already rotated has been presented. The legitimate holder would
      // have the newer one, so this was captured — revoke the whole family, since
      // the attacker may already hold a descendant.
      await this.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.familyId, found.familyId), isNull(userSessions.revokedAt)));

      await this.audit.record({
        ...ctx,
        actorId: found.userId,
        action: 'auth.refresh.reuse_detected',
        resourceType: 'session_family',
        resourceId: found.familyId,
        reason: 'token_reuse_family_revoked',
      });
      throw invalidCredentials();
    }

    if (!this.sessions.isUsable(found)) throw invalidCredentials();
    await this.requireSessionMayContinue(found.userId, ctx);

    const next = this.sessions.rotate(found);
    await this.db.transaction(async (tx) => {
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(eq(userSessions.id, found.id));
      await tx.insert(userSessions).values({
        id: next.sessionId,
        userId: found.userId,
        familyId: next.familyId,
        refreshTokenHash: next.refreshTokenHash,
        expiresAt: next.expiresAt,
        ipAddress: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
      });
    });

    await this.audit.record({
      ...ctx,
      actorId: found.userId,
      action: 'auth.refresh',
      resourceType: 'session',
      resourceId: next.sessionId,
    });

    return { userId: found.userId, refreshToken: next.refreshToken };
  }

  async revoke(refreshToken: string, ctx: RequestContext): Promise<void> {
    const hash = this.tokens.fingerprint(refreshToken);
    const [revoked] = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.refreshTokenHash, hash), isNull(userSessions.revokedAt)))
      .returning();

    if (revoked) {
      await this.audit.record({
        ...ctx,
        actorId: revoked.userId,
        action: 'auth.logout',
        resourceType: 'session',
        resourceId: revoked.id,
      });
    }
  }

  // ── Email verification and password reset ─────────────────────────────────────

  /**
   * Issues a single-use token and mails it. Outstanding tokens for the same purpose are
   * consumed first, so only the newest link works — otherwise every link ever sent stays
   * live until it expires, and the oldest leaked inbox still wins.
   */
  private async issueToken(
    userId: string,
    purpose: TokenPurpose,
    email: string,
    ctx: RequestContext,
  ): Promise<void> {
    await this.db
      .update(userTokens)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(userTokens.userId, userId),
          eq(userTokens.purpose, purpose),
          isNull(userTokens.consumedAt),
        ),
      );

    const issued = this.userTokens.issue(purpose);
    await this.db.insert(userTokens).values({
      userId,
      purpose,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
    });

    const path = purpose === 'EMAIL_VERIFICATION' ? 'verify-email' : 'reset-password';
    await this.mailer.send({
      to: email,
      template: purpose === 'EMAIL_VERIFICATION' ? 'email_verification' : 'password_reset',
      // The token travels here and nowhere else. It is not audited and not logged.
      variables: {
        url: `${process.env['APP_BASE_URL'] ?? 'http://localhost:3000'}/${path}?token=${issued.token}`,
      },
    });

    await this.audit.record({
      ...ctx,
      actorId: userId,
      action: purpose === 'EMAIL_VERIFICATION' ? 'auth.verification.sent' : 'auth.reset.requested',
      resourceType: 'user',
      resourceId: userId,
    });
  }

  /** Always resolves. Whether the address exists is not something a caller may learn. */
  async requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
    await this.limits.consume('resetPerIp', ctx.ip ?? 'unknown');
    await this.limits.consume('resetPerAccount', accountKey(email));

    const user = await this.db.query.users.findFirst({
      where: and(eq(users.email, email), isNull(users.deletedAt)),
    });
    if (!user) {
      await this.audit.record({
        ...ctx,
        action: 'auth.reset.requested',
        resourceType: 'user',
        reason: 'no_account',
      });
      return;
    }

    await this.issueToken(user.id, 'PASSWORD_RESET', user.email, ctx);
  }

  /**
   * Resets the password and revokes every session the user has.
   *
   * The revocation is the point. Someone resetting a password is frequently doing it
   * because an attacker holds the old one; leaving existing sessions alive would hand
   * the attacker continued access through a token the new password cannot touch.
   */
  async resetPassword(token: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const row = await this.db.query.userTokens.findFirst({
      where: and(
        eq(userTokens.tokenHash, this.userTokens.fingerprint(token)),
        eq(userTokens.purpose, 'PASSWORD_RESET'),
      ),
    });

    if (!row || !this.userTokens.isRedeemable(row)) {
      await this.audit.record({
        ...ctx,
        action: 'auth.reset.failed',
        resourceType: 'user',
        reason: row ? 'token_spent_or_expired' : 'token_unknown',
      });
      throw invalidCredentials();
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.db.transaction(async (tx) => {
      await tx.update(userTokens).set({ consumedAt: new Date() }).where(eq(userTokens.id, row.id));
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, row.userId));
      await tx
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, row.userId), isNull(userSessions.revokedAt)));
    });

    await this.audit.record({
      ...ctx,
      actorId: row.userId,
      action: 'auth.reset.completed',
      resourceType: 'user',
      resourceId: row.userId,
      reason: 'all_sessions_revoked',
    });
  }

  /** Consumes a verification token and activates the account. */
  async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const row = await this.db.query.userTokens.findFirst({
      where: and(
        eq(userTokens.tokenHash, this.userTokens.fingerprint(token)),
        eq(userTokens.purpose, 'EMAIL_VERIFICATION'),
      ),
    });

    if (!row || !this.userTokens.isRedeemable(row)) {
      await this.audit.record({
        ...ctx,
        action: 'auth.verification.failed',
        resourceType: 'user',
        reason: row ? 'token_spent_or_expired' : 'token_unknown',
      });
      throw invalidCredentials();
    }

    await this.db.transaction(async (tx) => {
      await tx.update(userTokens).set({ consumedAt: new Date() }).where(eq(userTokens.id, row.id));
      await tx
        .update(users)
        .set({ emailVerifiedAt: new Date(), status: 'ACTIVE', updatedAt: new Date() })
        // Only promotes an account still waiting. A SUSPENDED user clicking an old
        // verification link must not reactivate themselves.
        .where(and(eq(users.id, row.userId), eq(users.status, 'PENDING_VERIFICATION')));
    });

    await this.audit.record({
      ...ctx,
      actorId: row.userId,
      action: 'auth.verification.completed',
      resourceType: 'user',
      resourceId: row.userId,
    });
  }

  // ── Session management ────────────────────────────────────────────────────────

  /**
   * Check 2 of the six, applied to an existing session rather than a new sign-in.
   *
   * Without it, suspension only blocks the next login: every session opened beforehand
   * keeps rotating until it expires. Confirmed before the fix -- a suspended account
   * refreshed successfully.
   *
   * The sessions are revoked here, not merely refused. Leaving the rows live means the
   * refusal has to be repeated correctly at every future call site; revoking ends it once.
   */
  private async requireSessionMayContinue(userId: string, ctx: RequestContext): Promise<void> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });

    // A soft-deleted account keeps its status, so `deletedAt` has to be checked as well —
    // otherwise erasing an account would leave its sessions rotating. A missing row means
    // the same thing: the foreign key cascades, so its absence is an account that is gone.
    let reason: string;
    if (user && user.deletedAt === null) {
      if (!SESSION_ENDING_STATUSES.some((s) => s === user.status)) return;
      reason = `account_${user.status.toLowerCase()}`;
    } else {
      reason = 'account_deleted';
    }

    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));

    await this.audit.record({
      ...ctx,
      actorId: userId,
      action: 'auth.session.terminated',
      resourceType: 'user',
      resourceId: userId,
      reason,
    });

    throw invalidCredentials();
  }

  async listSessions(actor: Actor, ctx: RequestContext): Promise<SessionSummary[]> {
    const rows = await this.sessionRepo.findAllForActor(actor);

    await this.audit.record({
      ...ctx,
      actorId: actor.userId,
      action: 'auth.sessions.listed',
      resourceType: 'user',
      resourceId: actor.userId,
    });

    // No hashes leave this method: knowing another session's hash would be knowing a
    // credential. `current` comes from the Actor's own session id rather than a hash
    // comparison, so the hash never has to be handled here at all.
    return rows
      .filter((r) => this.sessions.isUsable(r))
      .map((r) => ({
        id: r.id,
        ipAddress: r.ipAddress,
        userAgent: r.userAgent,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        expiresAt: r.expiresAt,
        current: r.id === actor.sessionId,
      }));
  }

  /**
   * Revokes one of the caller's own sessions.
   *
   * Check 4 of the six, done as a scoped read rather than a comparison: the repository
   * only returns rows belonging to this actor, so a session id owned by somebody else is
   * simply absent. `authz.visible` turns that absence into a 404 -- the same answer as an
   * id that never existed, so the endpoint cannot be used to confirm one.
   */
  async revokeSession(actor: Actor, sessionId: string, ctx: RequestContext): Promise<void> {
    const found = await this.sessionRepo.findOneForActor(actor, sessionId);
    const session = await this.authz.visible(actor, found, {
      action: 'session.revoke',
      resourceType: 'session',
      resourceId: sessionId,
      correlationId: ctx.correlationId,
      ipAddress: ctx.ip,
    });

    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(eq(userSessions.id, session.id));

    await this.audit.record({
      ...ctx,
      actorId: actor.userId,
      action: 'auth.sessions.revoked',
      resourceType: 'session',
      resourceId: session.id,
    });
  }
}
