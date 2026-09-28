import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_JWKS_URL,
  GOOGLE_TOKEN_URL,
  GoogleOAuthClient,
  googleFromEnv,
  pkceChallenge,
  sha256,
} from './google-oauth.client';

/** The private half of a key pair from `generateKeyPair`. */
type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

/**
 * Google's half of sign-in (T-062), against a key pair made here: every check the ID token passes
 * is exercised with a token actually signed, and one that differs in each way that must fail.
 */
const CONFIG = {
  clientId: 'client-123.apps.googleusercontent.com',
  clientSecret: 'secret-not-a-real-one',
  redirectUri: 'http://localhost:3001/api/v1/auth/google/callback',
};
const NONCE = 'the-nonce-this-sign-in-sent';

let key: SigningKey;
let otherKey: SigningKey;
let client: GoogleOAuthClient;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  otherKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  client = new GoogleOAuthClient(CONFIG, { keys: createLocalJWKSet({ keys: [jwk] }) });
});

/** A Google-shaped ID token; any claim given replaces the good one, including iss, aud and sub. */
const token = (claims: JWTPayload = {}, opts: { signWith?: SigningKey; exp?: string } = {}) =>
  new SignJWT({
    iss: 'https://accounts.google.com',
    aud: CONFIG.clientId,
    sub: 'google-sub-1',
    email: 'ana@example.test',
    email_verified: true,
    nonce: NONCE,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.signWith ?? key);

describe('Google sign-in: where the browser is sent', () => {
  it('asks for identity only, with state, nonce and an S256 challenge, to the one callback', () => {
    const url = new URL(client.authorizationUrl({ state: 's', nonce: 'n', codeVerifier: 'v' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: 's',
      nonce: 'n',
      code_challenge: pkceChallenge('v'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    // RFC 7636 appendix B's own example.
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('Google sign-in: the code exchange', () => {
  it('posts the code, verifier and secret server to server, and keeps only the ID token', async () => {
    const fetch = vi.fn(async () =>
      Response.json({ id_token: 'the-id-token', access_token: 'never-kept', refresh_token: 'nor' }),
    );
    const c = new GoogleOAuthClient(CONFIG, { fetch });
    expect(await c.exchange('the-code', 'the-verifier')).toBe('the-id-token');
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(GOOGLE_TOKEN_URL);
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'the-code',
      code_verifier: 'the-verifier',
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret,
      redirect_uri: CONFIG.redirectUri,
    });
  });

  it.each([
    ['a refusal', async () => Response.json({ error: 'invalid_grant' }, { status: 400 })],
    ['no ID token', async () => Response.json({ access_token: 'x' })],
    ['a body that is not JSON', async () => new Response('<html>', { status: 200 })],
    [
      'no answer at all',
      async () => {
        throw new TypeError('fetch failed');
      },
    ],
  ])('fails as exchange_failed on %s', async (_label, reply) => {
    const c = new GoogleOAuthClient(CONFIG, { fetch: vi.fn(reply) });
    await expect(c.exchange('c', 'v')).rejects.toMatchObject({ reason: 'exchange_failed' });
  });
});

describe('Google sign-in: the ID token', () => {
  it('is believed when signed by Google’s key, for this client, unexpired, with this nonce', async () => {
    expect(await client.verify(await token(), sha256(NONCE))).toEqual({
      subject: 'google-sub-1',
      email: 'ana@example.test',
      emailVerified: true,
    });
    // The short issuer form Google also writes.
    const short = await new SignJWT({ email: 'a@b.test', nonce: NONCE })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('accounts.google.com')
      .setAudience(CONFIG.clientId)
      .setSubject('s')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    expect(await client.verify(short, sha256(NONCE))).toMatchObject({ emailVerified: false });
  });

  it('reads an address Google has not confirmed as unconfirmed — only a true `true` counts', async () => {
    for (const claim of [false, 'true', undefined]) {
      const t = await token({ email_verified: claim });
      expect((await client.verify(t, sha256(NONCE))).emailVerified).toBe(false);
    }
  });

  it.each([
    ['another client’s token', () => token({ aud: 'someone-else.apps.googleusercontent.com' })],
    ['another issuer', () => token({ iss: 'https://evil.example' })],
    ['an expired token', () => token({}, { exp: '-1m' })],
    ['a signature by another key', () => token({}, { signWith: otherKey })],
    ['another sign-in’s nonce', () => token({ nonce: 'replayed-from-elsewhere' })],
    ['no nonce', () => token({ nonce: undefined })],
    ['no address', () => token({ email: undefined })],
    ['an empty subject', () => token({ sub: '' })],
    [
      'a token that picks its own algorithm',
      () =>
        new SignJWT({ email: 'a@b.test', nonce: NONCE })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuer('https://accounts.google.com')
          .setAudience(CONFIG.clientId)
          .setSubject('s')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode(CONFIG.clientSecret)),
    ],
    ['something that is not a token', async () => 'not.a.jwt'],
  ])('refuses %s', async (_label, make) => {
    await expect(client.verify(await make(), sha256(NONCE))).rejects.toMatchObject({
      reason: 'token_invalid',
    });
  });
});

describe('Google sign-in: configuration', () => {
  it('is on with all three settings, and off without any one of them', () => {
    const all = {
      GOOGLE_OAUTH_CLIENT_ID: 'id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
      GOOGLE_OAUTH_REDIRECT_URI: CONFIG.redirectUri,
    };
    expect(googleFromEnv(all)?.config).toEqual({
      clientId: 'id',
      clientSecret: 'secret',
      redirectUri: CONFIG.redirectUri,
    });
    for (const missing of Object.keys(all)) {
      expect(googleFromEnv({ ...all, [missing]: undefined })).toBeNull();
    }
  });
});

describe('Google sign-in: talking to Google itself', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the platform’s fetch, and Google’s published keys, when given neither', async () => {
    const pair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-1', alg: 'RS256' };
    const idToken = await new SignJWT({
      iss: 'https://accounts.google.com',
      aud: CONFIG.clientId,
      sub: 'google-sub-2',
      email: 'bo@example.test',
      email_verified: true,
      nonce: NONCE,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'google-1' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(pair.privateKey);
    const fetch = vi.fn(async (input: string | URL | Request) =>
      String(input instanceof Request ? input.url : input) === GOOGLE_JWKS_URL
        ? Response.json({ keys: [jwk] })
        : Response.json({ id_token: idToken }),
    );
    vi.stubGlobal('fetch', fetch);

    const plain = new GoogleOAuthClient(CONFIG);
    const received = await plain.exchange('code', 'verifier');
    expect(await plain.verify(received, sha256(NONCE))).toMatchObject({ subject: 'google-sub-2' });
    const asked = fetch.mock.calls.map(([input]) =>
      String(input instanceof Request ? input.url : input),
    );
    expect(asked).toEqual([GOOGLE_TOKEN_URL, GOOGLE_JWKS_URL]);
  });
});
