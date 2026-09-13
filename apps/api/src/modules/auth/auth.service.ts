import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { DB, type Db } from '../../database/database.module';
import { userSessions, users } from '../../database/schema';
import { invalidCredentials } from './auth.errors';
import { PasswordService } from './password.service';
import { RateLimitService } from './rate-limit.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

export interface RequestContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
  correlationId?: string | undefined;
}

export interface AuthResult {
  userId: string;
  refreshToken: string;
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
    await this.audit.record({
      ...ctx,
      actorId: created?.id,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: created?.id,
    });
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
}
