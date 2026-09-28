import { createHash, randomBytes } from 'node:crypto';
import type { JWTVerifyGetKey } from 'jose' with { 'resolution-mode': 'import' };

/** The provider token: the configured client, or `null` when Google sign-in is not set up. */
export const GOOGLE_OAUTH = Symbol('GOOGLE_OAUTH');

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google writes either form in `iss`; both are its own (OpenID discovery document). */
export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
/** Who someone is, and nothing more: no Drive, no contacts, no offline access. */
export const GOOGLE_SCOPES = 'openid email profile';

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** What the platform believes about a Google identity, once the ID token has been verified. */
export interface GoogleIdentity {
  /** Google's stable account id — the only thing an identity is matched on. */
  subject: string;
  email: string;
  emailVerified: boolean;
}

/** Why the provider leg failed. Never the provider's own words: they reach no one. */
export class GoogleOAuthError extends Error {
  constructor(readonly reason: 'exchange_failed' | 'token_invalid') {
    super(reason);
  }
}

/** A random value for `state`, `nonce` or the PKCE verifier: 32 bytes, URL-safe. */
export const randomToken = (): string => randomBytes(32).toString('base64url');

/** SHA-256, as stored: a leaked row holds no usable state, nonce or sign-up token. */
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** The PKCE S256 challenge for a verifier (RFC 7636 §4.2). */
export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

// `jose` is ESM-only and the API compiles to CommonJS; a dynamic import stays an import.
type Jose = typeof import('jose', { with: { 'resolution-mode': 'import' } });
let jose: Promise<Jose> | undefined;
const loadJose = (): Promise<Jose> => (jose ??= import('jose'));

/**
 * Google's half of the Authorization Code flow with PKCE (T-062): where to send the browser, the
 * server-side code exchange — the only place the client secret is used — and verification of the
 * ID token that comes back.
 *
 * The ID token is never trusted on presentation. Its signature is checked against Google's
 * published keys, and its issuer, audience, expiry and nonce against what this sign-in expects;
 * only RS256 is accepted, so a token cannot choose a weaker algorithm for itself.
 */
export class GoogleOAuthClient {
  constructor(
    readonly config: GoogleConfig,
    private readonly options: {
      fetch?: typeof fetch;
      /** The key set to verify against. Google's, fetched and cached, unless a test gives its own. */
      keys?: JWTVerifyGetKey;
    } = {},
  ) {}

  private remoteKeys: JWTVerifyGetKey | undefined;

  authorizationUrl(input: { state: string; nonce: string; codeVerifier: string }): string {
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      state: input.state,
      nonce: input.nonce,
      code_challenge: pkceChallenge(input.codeVerifier),
      code_challenge_method: 'S256',
      // Choosing the account every time: a shared computer's last Google user is not assumed.
      prompt: 'select_account',
    }).toString();
    return url.toString();
  }

  /** Trades the code for tokens, server to server. Returns the ID token and nothing else. */
  async exchange(code: string, codeVerifier: string): Promise<string> {
    const doFetch = this.options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          code_verifier: codeVerifier,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          redirect_uri: this.config.redirectUri,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GoogleOAuthError('exchange_failed');
    }
    if (!res.ok) throw new GoogleOAuthError('exchange_failed');
    const body = (await res.json().catch(() => ({}))) as { id_token?: unknown };
    // The access token in the same body is never read, kept or logged: identity is all we need.
    if (typeof body.id_token !== 'string') throw new GoogleOAuthError('exchange_failed');
    return body.id_token;
  }

  /** Verifies the ID token, then reads who it says this is. Anything amiss is `token_invalid`. */
  async verify(idToken: string, expectedNonceHash: string): Promise<GoogleIdentity> {
    const { jwtVerify, createRemoteJWKSet } = await loadJose();
    const keys =
      this.options.keys ?? (this.remoteKeys ??= createRemoteJWKSet(new URL(GOOGLE_JWKS_URL)));
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.config.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      }));
    } catch {
      throw new GoogleOAuthError('token_invalid');
    }
    const { sub, email, email_verified: verified, nonce } = payload;
    if (typeof nonce !== 'string' || sha256(nonce) !== expectedNonceHash) {
      throw new GoogleOAuthError('token_invalid');
    }
    if (typeof sub !== 'string' || sub === '' || typeof email !== 'string' || email === '') {
      throw new GoogleOAuthError('token_invalid');
    }
    // Google has sent the claim as a string in some flows; only a true `true` counts.
    return { subject: sub, email: email.toLowerCase(), emailVerified: verified === true };
  }
}

/** The configured client, or `null`: without all three settings there is no Google sign-in. */
export function googleFromEnv(env: Record<string, string | undefined>): GoogleOAuthClient | null {
  const clientId = env['GOOGLE_OAUTH_CLIENT_ID'];
  const clientSecret = env['GOOGLE_OAUTH_CLIENT_SECRET'];
  const redirectUri = env['GOOGLE_OAUTH_REDIRECT_URI'];
  return clientId && clientSecret && redirectUri
    ? new GoogleOAuthClient({ clientId, clientSecret, redirectUri })
    : null;
}
