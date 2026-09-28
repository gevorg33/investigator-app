import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { DB, type Db, type Tx } from '../../database/database.module';
import { oauthAttempts, userIdentities, users } from '../../database/schema';
import { LegalService } from '../legal/legal.service';
import { REQUIRED_AT_REGISTRATION } from '../legal/legal.policy';
import { AuthService, type AuthResult, type RequestContext } from './auth.service';
import {
  GOOGLE_OAUTH,
  GoogleOAuthError,
  randomToken,
  sha256,
  type GoogleIdentity,
  type GoogleOAuthClient,
} from './google-oauth.client';
import { RateLimitService } from './rate-limit.service';

/** How long the trip to Google may take, and how long a waiting sign-up stays open after it. */
export const ATTEMPT_TTL_MS = 10 * 60 * 1000;
export const SIGNUP_TTL_MS = 30 * 60 * 1000;
/** Lapsed attempts are deleted at the next start, a day on (retention.md). */
const PURGE_AFTER = sql`interval '1 day'`;

/** Why a Google sign-in did not go through, as the app words it. No reason says more than this. */
export type GoogleFailure =
  /** The person cancelled at Google's consent screen. */
  | 'denied'
  /** Anything wrong with the trip itself: state, expiry, reuse, the exchange, the token, the account. */
  | 'failed'
  /** Google has not confirmed the address, so it can neither create nor join an account. */
  | 'unverified'
  /** An account has this address and cannot be joined automatically: sign in, then connect. */
  | 'exists'
  /** LINK: this Google account belongs to another account, or this one already has a Google link. */
  | 'taken';

export type CallbackOutcome =
  | { kind: 'session'; session: AuthResult; returnTo: string }
  | { kind: 'signup'; signupToken: string; returnTo: string }
  | { kind: 'linked'; returnTo: string }
  | { kind: 'failed'; reason: GoogleFailure; intent: 'SIGN_IN' | 'LINK' };

export interface LinkedIdentity {
  id: string;
  provider: 'GOOGLE';
  email: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

const audited = (ctx: RequestContext) => ({
  ipAddress: ctx.ip,
  userAgent: ctx.userAgent,
  correlationId: ctx.correlationId,
});

/**
 * A path on the app to return to, or `/`. Relative only: no scheme, no host, no `//` or `/\`
 * that a browser would read as another host — so the callback can never be an open redirect.
 */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  // Control characters and backslashes have no place in a path we send someone to.
  return /[\u0000-\u001f\\]/.test(value) ? '/' : value;
}

const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Sign in with Google (T-062) — alongside email and password, never instead of the platform's own
 * session: Google's tokens prove who someone is once, and are then forgotten.
 *
 * Linking to an existing account is where the danger is. A Google identity joins an account
 * automatically only when **both** addresses are verified — Google's `email_verified`, and the
 * account's own confirmation. Otherwise anyone who can make a Google account for an address, or
 * register one here unconfirmed, would inherit the other side. Any other link is an explicit,
 * signed-in action by the account holder.
 */
@Injectable()
export class GoogleAuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(GOOGLE_OAUTH) private readonly google: GoogleOAuthClient | null,
    private readonly auth: AuthService,
    private readonly legal: LegalService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
  ) {}

  get enabled(): boolean {
    return this.google !== null;
  }

  /**
   * Starts a trip to Google: an attempt row holding the hashes, and the browser's half — state and
   * PKCE verifier — for the caller to put in an httpOnly cookie. `actor` makes it a LINK, for them.
   */
  async start(
    input: { returnTo: unknown; actor?: Actor },
    ctx: RequestContext,
  ): Promise<{ url: string; cookie: string }> {
    const google = this.requireGoogle();
    await this.limits.consume('loginPerIp', ctx.ip ?? 'unknown');

    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken();
    await this.db
      .delete(oauthAttempts)
      .where(
        and(
          lt(oauthAttempts.expiresAt, sql`now() - ${PURGE_AFTER}`),
          or(
            isNull(oauthAttempts.signupExpiresAt),
            lt(oauthAttempts.signupExpiresAt, sql`now() - ${PURGE_AFTER}`),
          ),
        ),
      );
    await this.db.insert(oauthAttempts).values({
      provider: 'GOOGLE',
      intent: input.actor === undefined ? 'SIGN_IN' : 'LINK',
      stateHash: sha256(state),
      nonceHash: sha256(nonce),
      userId: input.actor?.userId ?? null,
      returnTo: safeReturnTo(input.returnTo),
      expiresAt: new Date(Date.now() + ATTEMPT_TTL_MS),
    });
    return {
      url: google.authorizationUrl({ state, nonce, codeVerifier }),
      cookie: `${state}.${codeVerifier}`,
    };
  }

  /**
   * Google's callback. Believed only when the `state` it carries is the one in this browser's
   * cookie **and** names an unexpired attempt not yet used — then the attempt is spent, whatever
   * follows, so the same callback can never be replayed.
   */
  async callback(
    query: { code?: unknown; state?: unknown; error?: unknown },
    cookie: string | undefined,
    ctx: RequestContext,
  ): Promise<CallbackOutcome> {
    const google = this.requireGoogle();
    const [cookieState, codeVerifier] = (cookie ?? '').split('.');
    const state = typeof query.state === 'string' ? query.state : '';
    if (!cookieState || !codeVerifier || !state || !sameSecret(cookieState, state)) {
      return this.fail('failed', 'SIGN_IN', ctx, 'state_mismatch');
    }

    // Spent here, in one statement: a second callback with the same state finds nothing.
    const [attempt] = await this.db
      .update(oauthAttempts)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(oauthAttempts.stateHash, sha256(state)),
          isNull(oauthAttempts.consumedAt),
          gt(oauthAttempts.expiresAt, new Date()),
        ),
      )
      .returning();
    if (attempt === undefined) return this.fail('failed', 'SIGN_IN', ctx, 'state_spent_or_expired');

    if (query.error !== undefined) {
      return this.fail(
        query.error === 'access_denied' ? 'denied' : 'failed',
        attempt.intent,
        ctx,
        'provider_error',
      );
    }
    if (typeof query.code !== 'string' || query.code === '') {
      return this.fail('failed', attempt.intent, ctx, 'no_code');
    }

    let identity: GoogleIdentity;
    try {
      identity = await google.verify(
        await google.exchange(query.code, codeVerifier),
        attempt.nonceHash,
      );
    } catch (e) {
      if (!(e instanceof GoogleOAuthError)) throw e;
      return this.fail('failed', attempt.intent, ctx, e.reason);
    }

    return attempt.intent === 'LINK'
      ? this.link(attempt.userId!, identity, attempt.returnTo, ctx)
      : this.signIn(attempt.id, identity, attempt.returnTo, ctx);
  }

  /** The address a waiting sign-up will use, so the terms page can say whose account it creates. */
  async pending(signupToken: string | undefined): Promise<{ email: string } | null> {
    const row = await this.openSignup(this.db, signupToken);
    return row === undefined ? null : { email: row.providerEmail! };
  }

  /**
   * Completes a first Google sign-in: the account, its Google identity and its acceptance of the
   * required documents, together or not at all (legal-consent). The address is confirmed — Google
   * confirmed it — so the account is ACTIVE from the start. Refused documents leave the sign-up
   * open to try again; a completed one cannot be completed twice.
   */
  async complete(
    signupToken: string | undefined,
    acceptedDocumentIds: readonly string[],
    preferences: { locale?: string | undefined; timezone?: string | undefined },
    ctx: RequestContext,
  ): Promise<AuthResult> {
    await this.limits.consume('registerPerIp', ctx.ip ?? 'unknown');
    const userId = await this.db.transaction(async (tx) => {
      const row = await this.openSignup(tx, signupToken, true);
      if (row === undefined) throw AppError.stateConflict();

      const taken = await tx.query.users.findFirst({ where: eq(users.email, row.providerEmail!) });
      // Registered since the callback: joining it now would skip the checks linking needs.
      if (taken !== undefined) throw AppError.stateConflict();

      const now = new Date();
      const [user] = await tx
        .insert(users)
        .values({
          email: row.providerEmail!,
          emailVerifiedAt: now,
          status: 'ACTIVE',
          ...(preferences.locale !== undefined && { locale: preferences.locale }),
          ...(preferences.timezone !== undefined && { timezone: preferences.timezone }),
        })
        .returning();
      await this.legal.requireAcceptance(
        {
          userId: user!.id,
          types: REQUIRED_AT_REGISTRATION,
          acceptedDocumentIds,
          context: 'REGISTRATION',
        },
        ctx,
        tx,
      );
      const [identity] = await tx
        .insert(userIdentities)
        .values({
          userId: user!.id,
          provider: 'GOOGLE',
          providerAccountId: row.providerAccountId!,
          providerEmail: row.providerEmail,
          lastUsedAt: now,
        })
        .returning();
      await tx.update(oauthAttempts).set({ completedAt: now }).where(eq(oauthAttempts.id, row.id));
      const base = {
        ...audited(ctx),
        actorId: user!.id,
        resourceType: 'user',
        resourceId: user!.id,
      };
      await this.audit.record({ ...base, action: 'auth.register', reason: 'google' }, tx);
      await this.audit.record(
        {
          ...base,
          action: 'auth.identity.linked',
          resourceType: 'user_identity',
          resourceId: identity!.id,
          reason: 'signup',
        },
        tx,
      );
      return user!.id;
    });
    return this.auth.openSession(userId, ctx, 'google');
  }

  /** The caller's sign-in methods: whether they have a password, and each linked identity. */
  async methods(actor: Actor): Promise<{ password: boolean; identities: LinkedIdentity[] }> {
    const [user] = await this.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, actor.userId));
    const identities = await this.db
      .select({
        id: userIdentities.id,
        provider: userIdentities.provider,
        email: userIdentities.providerEmail,
        createdAt: userIdentities.createdAt,
        lastUsedAt: userIdentities.lastUsedAt,
      })
      .from(userIdentities)
      .where(eq(userIdentities.userId, actor.userId));
    return { password: user?.passwordHash != null, identities };
  }

  /**
   * Disconnects one of the caller's identities — never the last way in: an account with no password
   * and no other identity would be locked out, so that is refused and it says how to add a password.
   */
  async unlink(actor: Actor, identityId: string, ctx: RequestContext): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Locked: two disconnects at once must not each see the other as the remaining way in.
      const [user] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, actor.userId))
        .for('update');
      const mine = await tx
        .select({ id: userIdentities.id })
        .from(userIdentities)
        .where(eq(userIdentities.userId, actor.userId));
      // Another account's identity reads exactly like one that does not exist.
      if (!mine.some((i) => i.id === identityId)) throw new AppError('NOT_FOUND');
      if (user?.passwordHash == null && mine.length === 1) {
        throw AppError.validation([
          {
            field: 'identity',
            code: 'LAST_METHOD',
            messageKey: 'error.validation.identity.last_method',
          },
        ]);
      }
      await tx.delete(userIdentities).where(eq(userIdentities.id, identityId));
      await this.audit.record(
        {
          ...audited(ctx),
          actorId: actor.userId,
          action: 'auth.identity.unlinked',
          resourceType: 'user_identity',
          resourceId: identityId,
        },
        tx,
      );
    });
  }

  // ── The callback's two paths ──────────────────────────────────────────────────

  private async signIn(
    attemptId: string,
    identity: GoogleIdentity,
    returnTo: string,
    ctx: RequestContext,
  ): Promise<CallbackOutcome> {
    const known = await this.db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.provider, 'GOOGLE'),
        eq(userIdentities.providerAccountId, identity.subject),
      ),
    });
    if (known !== undefined) {
      const user = await this.db.query.users.findFirst({ where: eq(users.id, known.userId) });
      // A deleted or suspended account is not signed into by another door (T-062, T-005).
      if (
        user === undefined ||
        user.deletedAt !== null ||
        user.status === 'SUSPENDED' ||
        user.status === 'DELETED'
      ) {
        return this.fail('failed', 'SIGN_IN', ctx, 'account_unavailable', known.userId);
      }
      await this.db
        .update(userIdentities)
        .set({ lastUsedAt: new Date(), providerEmail: identity.email })
        .where(eq(userIdentities.id, known.id));
      return {
        kind: 'session',
        session: await this.auth.openSession(user.id, ctx, 'google'),
        returnTo,
      };
    }

    // Unknown to us: it may only create or join an account on an address Google has confirmed.
    if (!identity.emailVerified) return this.fail('unverified', 'SIGN_IN', ctx, 'email_unverified');

    const existing = await this.db.query.users.findFirst({
      where: eq(users.email, identity.email),
    });
    if (existing !== undefined) {
      const hasGoogle = await this.db.query.userIdentities.findFirst({
        where: and(eq(userIdentities.userId, existing.id), eq(userIdentities.provider, 'GOOGLE')),
      });
      // Both sides verified, the account usable, and no other Google account on it: the same person.
      const joinable =
        existing.emailVerifiedAt !== null &&
        existing.deletedAt === null &&
        existing.status === 'ACTIVE' &&
        hasGoogle === undefined;
      if (!joinable)
        return this.fail('exists', 'SIGN_IN', ctx, 'account_not_joinable', existing.id);
      const [linked] = await this.db
        .insert(userIdentities)
        .values({
          userId: existing.id,
          provider: 'GOOGLE',
          providerAccountId: identity.subject,
          providerEmail: identity.email,
          lastUsedAt: new Date(),
        })
        .returning();
      await this.audit.record({
        ...audited(ctx),
        actorId: existing.id,
        action: 'auth.identity.linked',
        resourceType: 'user_identity',
        resourceId: linked!.id,
        reason: 'verified_email',
      });
      return {
        kind: 'session',
        session: await this.auth.openSession(existing.id, ctx, 'google'),
        returnTo,
      };
    }

    // A new person: nothing is created until they accept the documents (`complete`).
    const signupToken = randomToken();
    await this.db
      .update(oauthAttempts)
      .set({
        signupTokenHash: sha256(signupToken),
        providerAccountId: identity.subject,
        providerEmail: identity.email,
        signupExpiresAt: new Date(Date.now() + SIGNUP_TTL_MS),
      })
      .where(eq(oauthAttempts.id, attemptId));
    return { kind: 'signup', signupToken, returnTo };
  }

  private async link(
    userId: string,
    identity: GoogleIdentity,
    returnTo: string,
    ctx: RequestContext,
  ): Promise<CallbackOutcome> {
    const [owner, own] = await Promise.all([
      this.db.query.userIdentities.findFirst({
        where: and(
          eq(userIdentities.provider, 'GOOGLE'),
          eq(userIdentities.providerAccountId, identity.subject),
        ),
      }),
      this.db.query.userIdentities.findFirst({
        where: and(eq(userIdentities.userId, userId), eq(userIdentities.provider, 'GOOGLE')),
      }),
    ]);
    if (owner?.userId === userId) return { kind: 'linked', returnTo };
    if (owner !== undefined || own !== undefined)
      return this.fail('taken', 'LINK', ctx, 'identity_taken', userId);

    // Signed in and asking, so the account holder is the one linking: no address has to match.
    const [linked] = await this.db
      .insert(userIdentities)
      .values({
        userId,
        provider: 'GOOGLE',
        providerAccountId: identity.subject,
        providerEmail: identity.email,
      })
      .returning();
    await this.audit.record({
      ...audited(ctx),
      actorId: userId,
      action: 'auth.identity.linked',
      resourceType: 'user_identity',
      resourceId: linked!.id,
      reason: 'account_holder',
    });
    return { kind: 'linked', returnTo };
  }

  private async openSignup(db: Db | Tx, token: string | undefined, lock = false) {
    if (token === undefined || token === '') return undefined;
    const query = db
      .select()
      .from(oauthAttempts)
      .where(
        and(
          eq(oauthAttempts.signupTokenHash, sha256(token)),
          isNull(oauthAttempts.completedAt),
          gt(oauthAttempts.signupExpiresAt, new Date()),
        ),
      );
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  private async fail(
    reason: GoogleFailure,
    intent: 'SIGN_IN' | 'LINK',
    ctx: RequestContext,
    detail: string,
    userId?: string,
  ): Promise<CallbackOutcome> {
    // The detail is ours, never the provider's words, and never a token or a code.
    await this.audit.record({
      ...audited(ctx),
      ...(userId !== undefined && { actorId: userId, resourceId: userId }),
      action: intent === 'LINK' ? 'auth.identity.link_failed' : 'auth.login.failed',
      resourceType: 'user',
      reason: `google:${detail}`,
    });
    return { kind: 'failed', reason, intent };
  }

  private requireGoogle(): GoogleOAuthClient {
    if (this.google === null) throw new AppError('NOT_FOUND');
    return this.google;
  }
}
