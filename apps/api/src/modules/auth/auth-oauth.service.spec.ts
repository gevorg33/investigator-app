import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { testPool } from '../../../test/db';
import { readyPasswords } from '../../../test/passwords';
import { scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import * as schema from '../../database/schema';
import {
  auditLogs,
  legalDocuments,
  oauthAttempts,
  userConsents,
  userIdentities,
  userSessions,
  users,
} from '../../database/schema';
import { LegalService } from '../legal/legal.service';
import { REQUIRED_AT_REGISTRATION } from '../legal/legal.policy';
import { AuthService } from './auth.service';
import { GoogleAuthService, safeReturnTo, type CallbackOutcome } from './google-auth.service';
import { GoogleOAuthClient } from './google-oauth.client';
import { MemoryRateLimitStore, RateLimitService } from './rate-limit.service';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';

/** The private half of a key pair from `generateKeyPair`. */
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/**
 * Sign in with Google (T-062), against the real database and a Google stood in for by a key pair
 * made here: the ID tokens are really signed and really verified, and only the network is not.
 *
 * The linking tests are the point of the suite. A Google identity may join an existing account on
 * its own only when both addresses are verified; the test the task names — an unverified Google
 * address cannot take over an account — is `cannot join an account on an address Google has not
 * confirmed`.
 */
describe('Google sign-in (T-062)', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let google: GoogleAuthService;
  let limits: RateLimitService;
  let key: SigningKey;
  let keys: ReturnType<typeof createLocalJWKSet>;
  /** What Google's token endpoint answers next: the ID token for whoever "signed in". */
  let nextIdToken: string | undefined;

  const CLIENT_ID = 'client-123.apps.googleusercontent.com';
  const ctx = () => ({
    ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    userAgent: 'vitest',
    correlationId: randomUUID(),
  });

  beforeAll(async () => {
    sql = testPool({ max: 3 });
    ownerSql = testPool({ max: 3, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const pair = await generateKeyPair('RS256');
    key = pair.privateKey;
    keys = createLocalJWKSet({
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }],
    });
  });

  beforeEach(async () => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const tokens = new TokenService();
    const legal = new LegalService(db, audit);
    limits = new RateLimitService(new MemoryRateLimitStore());
    const auth = new AuthService(
      db,
      await readyPasswords(),
      tokens,
      new SessionService(tokens),
      limits,
      audit,
      new UserTokenService(tokens),
      { send: async () => undefined },
      new SessionRepository(db),
      new AuthzService(audit),
      legal,
    );
    const client = new GoogleOAuthClient(
      {
        clientId: CLIENT_ID,
        clientSecret: 'secret',
        redirectUri: 'http://localhost:3001/api/v1/auth/google/callback',
      },
      {
        keys,
        fetch: async () =>
          nextIdToken === undefined
            ? Response.json({ error: 'invalid_grant' }, { status: 400 })
            : Response.json({ id_token: nextIdToken, access_token: 'access-token-never-kept' }),
      },
    );
    google = new GoogleAuthService(db, client, auth, legal, audit, limits);
    nextIdToken = undefined;
  });

  afterEach(clearDocuments);

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  async function clearDocuments() {
    await ownerSql`
      DELETE FROM user_consents WHERE legal_document_id IN
        (SELECT id FROM legal_documents WHERE type = ANY(${[...REQUIRED_AT_REGISTRATION]}::legal_document_type[]))`;
    await ownerSql`
      DELETE FROM legal_documents WHERE type = ANY(${[...REQUIRED_AT_REGISTRATION]}::legal_document_type[])`;
  }

  const publishTerms = async () => {
    const rows = [];
    for (const type of REQUIRED_AT_REGISTRATION) {
      const [row] = await ownerDb
        .insert(legalDocuments)
        .values({
          type,
          version: 1,
          locale: 'en',
          title: type,
          content: `${type} ${randomUUID()}`,
          contentHash: 'computed-by-the-database',
          status: 'CURRENT',
          isAuthoritativeLocale: true,
          requiresReacceptance: true,
          publishedAt: new Date(),
          effectiveFrom: new Date(),
        })
        .returning();
      rows.push(row!.id);
    }
    return rows;
  };

  interface Person {
    sub?: string;
    email?: string;
    verified?: boolean;
  }

  /** Signs an ID token as Google would for `who`, carrying the nonce this sign-in sent. */
  const mint = (who: Person, nonce: string) =>
    new SignJWT({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: who.sub ?? `google-${randomUUID()}`,
      email: who.email ?? `g-${randomUUID()}@example.test`,
      email_verified: who.verified ?? true,
      nonce,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);

  /** Leaves for Google, and comes back as `who` — the way a browser carrying the cookie would. */
  const roundTrip = async (
    who: Person,
    opts: { actor?: ReturnType<typeof testActor>; nonce?: string; returnTo?: string } = {},
    c = ctx(),
  ): Promise<{ outcome: CallbackOutcome; state: string; cookie: string }> => {
    const { url, cookie } = await google.start(
      { returnTo: opts.returnTo ?? '/missions', ...(opts.actor && { actor: opts.actor }) },
      c,
    );
    const params = new URL(url).searchParams;
    const state = params.get('state')!;
    nextIdToken = await mint(who, opts.nonce ?? params.get('nonce')!);
    const outcome = await google.callback({ code: 'auth-code', state }, cookie, c);
    return { outcome, state, cookie };
  };

  /** An account made the way registration leaves one, with a password unless told otherwise. */
  const account = async (
    over: {
      verified?: boolean;
      password?: boolean;
      status?: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
      email?: string;
    } = {},
  ) => {
    const verified = over.verified ?? true;
    const [row] = await ownerDb
      .insert(users)
      .values({
        email: over.email ?? `local-${randomUUID()}@example.test`,
        passwordHash: over.password === false ? null : '$argon2id$not-a-real-hash',
        emailVerifiedAt: verified ? new Date() : null,
        status: over.status ?? (verified ? 'ACTIVE' : 'PENDING_VERIFICATION'),
      })
      .returning();
    return row!;
  };

  const identitiesOf = (userId: string) =>
    ownerDb.select().from(userIdentities).where(eq(userIdentities.userId, userId));
  const sessionsOf = (userId: string) =>
    ownerDb.select().from(userSessions).where(eq(userSessions.userId, userId));
  // What the rows say, in a fixed order — not when: `occurred_at` is the writing transaction's
  // start, so rows written together tie and a clock step reorders separate ones, and the table has no
  // write-order column. The audit claims which events were recorded, not their sequence (T-180).
  const audited = (correlationId: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.correlationId, correlationId))
      .orderBy(auditLogs.action, auditLogs.reason);

  describe('believing the callback', () => {
    it('refuses a callback whose state is not the one this browser was given', async () => {
      const { url, cookie } = await google.start({ returnTo: '/' }, ctx());
      const other = await google.start({ returnTo: '/' }, ctx());
      const state = new URL(other.url).searchParams.get('state')!;
      expect(await google.callback({ code: 'c', state }, cookie, ctx())).toEqual({
        kind: 'failed',
        reason: 'failed',
        intent: 'SIGN_IN',
      });
      // Nor without the cookie at all — the state in the address alone proves nothing.
      const own = new URL(url).searchParams.get('state')!;
      expect(await google.callback({ code: 'c', state: own }, undefined, ctx())).toMatchObject({
        kind: 'failed',
      });
    });

    it('believes a callback once: the same one again is refused', async () => {
      const first = await roundTrip({});
      expect(first.outcome.kind).toBe('signup');
      expect(
        await google.callback({ code: 'auth-code', state: first.state }, first.cookie, ctx()),
      ).toMatchObject({ kind: 'failed', reason: 'failed' });
    });

    it('refuses an attempt that has lapsed', async () => {
      const { url, cookie } = await google.start({ returnTo: '/' }, ctx());
      await ownerSql`UPDATE oauth_attempts SET expires_at = now() - interval '1 second'
                     WHERE consumed_at IS NULL AND expires_at > now()`;
      const state = new URL(url).searchParams.get('state')!;
      expect(await google.callback({ code: 'c', state }, cookie, ctx())).toMatchObject({
        kind: 'failed',
      });
    });

    it('says the person declined at Google, and spends the attempt', async () => {
      const { url, cookie } = await google.start({ returnTo: '/' }, ctx());
      const state = new URL(url).searchParams.get('state')!;
      expect(await google.callback({ error: 'access_denied', state }, cookie, ctx())).toEqual({
        kind: 'failed',
        reason: 'denied',
        intent: 'SIGN_IN',
      });
      expect(await google.callback({ code: 'c', state }, cookie, ctx())).toMatchObject({
        kind: 'failed',
        reason: 'failed',
      });
    });

    it('refuses an ID token minted for another sign-in, and a code Google would not exchange', async () => {
      expect((await roundTrip({}, { nonce: 'someone-elses-nonce' })).outcome).toMatchObject({
        kind: 'failed',
        reason: 'failed',
      });
      const { url, cookie } = await google.start({ returnTo: '/' }, ctx());
      nextIdToken = undefined;
      const state = new URL(url).searchParams.get('state')!;
      expect(await google.callback({ code: 'bad', state }, cookie, ctx())).toMatchObject({
        reason: 'failed',
      });
    });

    it('refuses a callback with no state, or no code, and one Google marked as failed', async () => {
      const { url, cookie } = await google.start({ returnTo: '/' }, ctx());
      expect(await google.callback({ code: 'c' }, cookie, ctx())).toMatchObject({
        reason: 'failed',
      });
      const state = new URL(url).searchParams.get('state')!;
      expect(await google.callback({ state }, cookie, ctx())).toMatchObject({ reason: 'failed' });

      const again = await google.start({ returnTo: '/' }, ctx());
      const s2 = new URL(again.url).searchParams.get('state')!;
      expect(
        await google.callback({ error: 'server_error', state: s2 }, again.cookie, ctx()),
      ).toMatchObject({ reason: 'failed' });
    });

    it('lets a fault that is not Google’s surface, rather than calling it a failed sign-in', async () => {
      const broken = new GoogleAuthService(
        scopedDb(sql),
        {
          authorizationUrl: () => 'https://accounts.google.com/?state=x',
          exchange: async () => {
            throw new TypeError('a bug, not a refusal');
          },
        } as unknown as GoogleOAuthClient,
        null as never,
        null as never,
        new AuditService(scopedDb(sql)),
        new RateLimitService(new MemoryRateLimitStore()),
      );
      // No address known for the caller: still budgeted, under one shared key.
      const { cookie } = await broken.start({ returnTo: '/' }, {});
      const state = cookie.split('.')[0]!;
      await expect(broken.callback({ code: 'c', state }, cookie, {})).rejects.toThrow(TypeError);
    });

    it('never records Google’s code, token or the state in the audit trail', async () => {
      const c = ctx();
      const { state } = await roundTrip({ verified: false }, {}, c);
      const rows = JSON.stringify(await audited(c.correlationId));
      expect(rows).toContain('google:email_unverified');
      for (const secret of ['auth-code', nextIdToken!, state, 'access-token-never-kept']) {
        expect(rows).not.toContain(secret);
      }
    });
  });

  describe('someone new', () => {
    it('creates nothing until the documents are accepted, then an ACTIVE, confirmed account', async () => {
      const documents = await publishTerms();
      const email = `new-${randomUUID()}@example.test`;
      const { outcome } = await roundTrip({ email, sub: 'sub-new-1' });
      expect(outcome).toMatchObject({ kind: 'signup', returnTo: '/missions' });
      const token = (outcome as { signupToken: string }).signupToken;
      expect(await google.pending(token)).toEqual({ email });
      expect(await ownerDb.select().from(users).where(eq(users.email, email))).toEqual([]);

      // Nothing accepted: refused, and the sign-up is still open to try again.
      await expect(google.complete(token, [], {}, ctx())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await ownerDb.select().from(users).where(eq(users.email, email))).toEqual([]);

      const c = ctx();
      const session = await google.complete(
        token,
        documents,
        { locale: 'hy', timezone: 'Asia/Yerevan' },
        c,
      );
      const [user] = await ownerDb.select().from(users).where(eq(users.id, session.userId));
      expect(user).toMatchObject({
        email,
        status: 'ACTIVE',
        passwordHash: null,
        locale: 'hy',
        timezone: 'Asia/Yerevan',
      });
      expect(user!.emailVerifiedAt).toBeInstanceOf(Date);
      expect(await identitiesOf(user!.id)).toMatchObject([
        { provider: 'GOOGLE', providerAccountId: 'sub-new-1', providerEmail: email },
      ]);
      const consents = await ownerDb
        .select()
        .from(userConsents)
        .where(eq(userConsents.userId, user!.id));
      expect(consents.map((r) => r.legalDocumentId).sort()).toEqual([...documents].sort());
      expect(await sessionsOf(user!.id)).toHaveLength(1);
      // Each acceptance is audited by the gate itself, as at any registration.
      expect((await audited(c.correlationId)).map((e) => [e.action, e.reason])).toEqual([
        ['auth.identity.linked', 'signup'],
        ['auth.login', 'google'],
        ['auth.register', 'google'],
        ['legal.consent.accepted', 'PRIVACY_POLICY v1 (en)'],
        ['legal.consent.accepted', 'TERMS_OF_SERVICE v1 (en)'],
      ]);

      // Done once: the same sign-up cannot make a second account, or be read again.
      await expect(google.complete(token, documents, {}, ctx())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
      expect(await google.pending(token)).toBeNull();
    });

    it('does not create an account on an address Google has not confirmed', async () => {
      const email = `unverified-${randomUUID()}@example.test`;
      expect((await roundTrip({ email, verified: false })).outcome).toEqual({
        kind: 'failed',
        reason: 'unverified',
        intent: 'SIGN_IN',
      });
      expect(await ownerDb.select().from(users).where(eq(users.email, email))).toEqual([]);
    });

    it('completes with nothing to accept when nothing is published, from an unknown address', async () => {
      const { outcome } = await roundTrip({});
      const session = await google.complete(
        (outcome as { signupToken: string }).signupToken,
        [],
        {},
        {},
      );
      const [user] = await ownerDb.select().from(users).where(eq(users.id, session.userId));
      expect(user).toMatchObject({ locale: 'en', timezone: 'UTC', status: 'ACTIVE' });
    });

    it('refuses a sign-up nobody started, and one left too long', async () => {
      expect(await google.pending(undefined)).toBeNull();
      expect(await google.pending('made-up')).toBeNull();
      const { outcome } = await roundTrip({});
      const token = (outcome as { signupToken: string }).signupToken;
      await ownerSql`UPDATE oauth_attempts SET signup_expires_at = now() - interval '1 second'
                     WHERE signup_token_hash IS NOT NULL AND completed_at IS NULL`;
      await expect(google.complete(token, [], {}, ctx())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
    });

    it('will not complete over an account registered with the address in the meantime', async () => {
      const email = `race-${randomUUID()}@example.test`;
      const { outcome } = await roundTrip({ email });
      await account({ email });
      await expect(
        google.complete((outcome as { signupToken: string }).signupToken, [], {}, ctx()),
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });
  });

  describe('someone with an account', () => {
    it('signs in by a linked identity, and notes when it was used', async () => {
      const user = await account();
      await ownerDb
        .insert(userIdentities)
        .values({ userId: user.id, provider: 'GOOGLE', providerAccountId: 'sub-known' });
      const { outcome } = await roundTrip({ sub: 'sub-known', email: 'renamed@example.test' });
      expect(outcome).toMatchObject({ kind: 'session', returnTo: '/missions' });
      expect((outcome as { session: { userId: string } }).session.userId).toBe(user.id);
      const [identity] = await identitiesOf(user.id);
      expect(identity).toMatchObject({ providerEmail: 'renamed@example.test' });
      expect(identity!.lastUsedAt).toBeInstanceOf(Date);
    });

    it('cannot join an account on an address Google has not confirmed', async () => {
      // The takeover this guards: a Google account made for someone else's address.
      const victim = await account();
      const { outcome } = await roundTrip({ email: victim.email, verified: false });
      expect(outcome).toEqual({ kind: 'failed', reason: 'unverified', intent: 'SIGN_IN' });
      expect(await identitiesOf(victim.id)).toEqual([]);
      expect(await sessionsOf(victim.id)).toEqual([]);
    });

    it('joins an account when both sides have confirmed the address, and says so in the audit', async () => {
      const user = await account();
      const c = ctx();
      const { outcome } = await roundTrip({ email: user.email, sub: 'sub-joined' }, {}, c);
      expect(outcome).toMatchObject({ kind: 'session' });
      expect(await identitiesOf(user.id)).toMatchObject([{ providerAccountId: 'sub-joined' }]);
      expect((await audited(c.correlationId)).map((e) => [e.action, e.reason])).toEqual([
        ['auth.identity.linked', 'verified_email'],
        ['auth.login', 'google'],
      ]);
    });

    it('does not join an account whose own address was never confirmed', async () => {
      // The other takeover: an account registered here, unconfirmed, on someone's Google address.
      const squatter = await account({ verified: false });
      const { outcome } = await roundTrip({ email: squatter.email });
      expect(outcome).toMatchObject({ kind: 'failed', reason: 'exists' });
      expect(await identitiesOf(squatter.id)).toEqual([]);
    });

    it('does not join an account that has another Google account already', async () => {
      const user = await account();
      await ownerDb
        .insert(userIdentities)
        .values({ userId: user.id, provider: 'GOOGLE', providerAccountId: 'sub-first' });
      expect((await roundTrip({ email: user.email, sub: 'sub-second' })).outcome).toMatchObject({
        reason: 'exists',
      });
    });

    it.each([
      ['suspended', { status: 'SUSPENDED' as const }],
      ['deleted', {}],
    ])('does not sign into a %s account', async (label, over) => {
      const user = await account(over);
      if (label === 'deleted') {
        await ownerSql`UPDATE users SET deleted_at = now(), status = 'DELETED' WHERE id = ${user.id}`;
      }
      await ownerDb
        .insert(userIdentities)
        .values({ userId: user.id, provider: 'GOOGLE', providerAccountId: `sub-${label}` });
      expect((await roundTrip({ sub: `sub-${label}` })).outcome).toMatchObject({
        kind: 'failed',
        reason: 'failed',
      });
      expect(await sessionsOf(user.id)).toEqual([]);
    });

    it('takes the linked identity with the account when it is deleted', async () => {
      const user = await account();
      await ownerDb
        .insert(userIdentities)
        .values({ userId: user.id, provider: 'GOOGLE', providerAccountId: 'sub-erased' });
      await ownerSql`DELETE FROM users WHERE id = ${user.id}`;
      expect(
        await ownerDb
          .select()
          .from(userIdentities)
          .where(eq(userIdentities.providerAccountId, 'sub-erased')),
      ).toEqual([]);
    });
  });

  describe('connecting Google to a signed-in account', () => {
    it('links whichever Google account the holder chooses, address or not', async () => {
      const user = await account();
      const c = ctx();
      const { outcome } = await roundTrip(
        { email: 'a-different-address@example.test', verified: false, sub: 'sub-linked' },
        { actor: testActor({ userId: user.id }), returnTo: '/account' },
        c,
      );
      expect(outcome).toEqual({ kind: 'linked', returnTo: '/account' });
      expect(await identitiesOf(user.id)).toMatchObject([{ providerAccountId: 'sub-linked' }]);
      expect((await audited(c.correlationId)).map((e) => [e.action, e.reason])).toEqual([
        ['auth.identity.linked', 'account_holder'],
      ]);
      // Linking again is nothing new.
      expect(
        (await roundTrip({ sub: 'sub-linked' }, { actor: testActor({ userId: user.id }) })).outcome,
      ).toMatchObject({ kind: 'linked' });
    });

    it('refuses a Google account another account holds, and a second one for this account', async () => {
      const [holder, other] = [await account(), await account()];
      await ownerDb
        .insert(userIdentities)
        .values({ userId: holder.id, provider: 'GOOGLE', providerAccountId: 'sub-held' });
      expect(
        (await roundTrip({ sub: 'sub-held' }, { actor: testActor({ userId: other.id }) })).outcome,
      ).toEqual({ kind: 'failed', reason: 'taken', intent: 'LINK' });
      expect(
        (await roundTrip({ sub: 'sub-another' }, { actor: testActor({ userId: holder.id }) }))
          .outcome,
      ).toMatchObject({ reason: 'taken' });
      expect(await identitiesOf(other.id)).toEqual([]);
    });
  });

  describe('sign-in methods', () => {
    const linked = async (over: Parameters<typeof account>[0] = {}) => {
      const user = await account(over);
      const [identity] = await ownerDb
        .insert(userIdentities)
        .values({
          userId: user.id,
          provider: 'GOOGLE',
          providerAccountId: `sub-${randomUUID()}`,
          providerEmail: user.email,
        })
        .returning();
      return { user, identity: identity!, actor: testActor({ userId: user.id }) };
    };

    it('lists whether there is a password, and each linked identity', async () => {
      const { user, identity, actor } = await linked({ password: false });
      expect(await google.methods(actor)).toEqual({
        password: false,
        identities: [
          {
            id: identity.id,
            provider: 'GOOGLE',
            email: user.email,
            createdAt: identity.createdAt,
            lastUsedAt: null,
          },
        ],
      });
    });

    it('never disconnects the last way in', async () => {
      const { identity, actor, user } = await linked({ password: false });
      await expect(google.unlink(actor, identity.id, ctx())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ messageKey: 'error.validation.identity.last_method' })],
      });
      expect(await identitiesOf(user.id)).toHaveLength(1);
    });

    it('disconnects Google from an account with a password, audited', async () => {
      const { identity, actor, user } = await linked();
      const c = ctx();
      await google.unlink(actor, identity.id, c);
      expect(await identitiesOf(user.id)).toEqual([]);
      expect(await audited(c.correlationId)).toMatchObject([
        { action: 'auth.identity.unlinked', resourceId: identity.id, actorId: user.id },
      ]);
    });

    it('answers another account’s identity as not found, and leaves it', async () => {
      const theirs = await linked();
      const mine = await account();
      await expect(
        google.unlink(testActor({ userId: mine.id }), theirs.identity.id, ctx()),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await identitiesOf(theirs.user.id)).toHaveLength(1);
    });
  });

  describe('abuse', () => {
    it('budgets leaving for Google on its own, never out of the password sign-in’s budget', async () => {
      // Any site can make a browser send the start: it must not lock that address out of passwords.
      const from = { ip: '203.0.113.9', userAgent: 'vitest', correlationId: randomUUID() };
      for (let i = 0; i < 20; i++) await google.start({ returnTo: '/' }, from);
      await expect(google.start({ returnTo: '/' }, from)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      await expect(limits.consume('loginPerIp', from.ip)).resolves.toBeUndefined();
    });
  });

  describe('housekeeping', () => {
    it('deletes attempts that lapsed more than a day ago when the next one starts', async () => {
      await ownerDb.insert(oauthAttempts).values({
        provider: 'GOOGLE',
        intent: 'SIGN_IN',
        stateHash: `old-${randomUUID()}`,
        nonceHash: 'n',
        expiresAt: new Date(Date.now() - 2 * 86_400_000),
      });
      await google.start({ returnTo: '/' }, ctx());
      const left =
        await ownerSql`SELECT 1 FROM oauth_attempts WHERE expires_at < now() - interval '1 day'`;
      expect(left).toHaveLength(0);
    });

    it('offers nothing without Google configured', async () => {
      const off = new GoogleAuthService(
        scopedDb(sql),
        null,
        null as never,
        null as never,
        null as never,
        null as never,
      );
      expect(off.enabled).toBe(false);
      await expect(off.start({ returnTo: '/' }, ctx())).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(off.callback({}, undefined, ctx())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
});

describe('where a sign-in may return to', () => {
  it.each([
    ['/missions?view=mine', '/missions?view=mine'],
    ['/', '/'],
    ['//evil.example/path', '/'],
    ['/\\evil.example', '/'],
    ['https://evil.example', '/'],
    ['javascript:alert(1)', '/'],
    ['missions', '/'],
    ['/a\u0000b', '/'],
    [`/${'x'.repeat(600)}`, '/'],
    [undefined, '/'],
    [['/a', '/b'], '/'],
  ])('%j → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
