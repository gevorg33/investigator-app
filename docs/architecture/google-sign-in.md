# Sign in with Google (T-062)

Google proves who someone is, once. What the browser then holds is the platform's own session —
the same host-only, `SameSite=Strict` refresh cookie a password sign-in sets (ADR-0002). Google's
tokens are never kept, logged or returned; only the ID token is read, and only after it is verified.

## The flow

```
app: "Continue with Google"  ── GET /api/v1/auth/google/start?next=/missions
API: attempt row (hashes of state + nonce), cookie investigator_oauth = state.verifier ── 303 → Google
Google: account chooser, consent ── 302 → /api/v1/auth/google/callback?code=…&state=…
API: state == cookie's state, attempt unspent and unexpired → spend it
     exchange code + PKCE verifier + client secret, server to server → ID token
     verify ID token (JWKS signature, issuer, audience, expiry, nonce, RS256 only)
     → session | waiting sign-up | link | failure
API: 200 page that navigates on to the app (meta refresh)
```

| Piece | Where | Why |
|---|---|---|
| Authorization Code + PKCE (S256) | `google-oauth.client.ts` | The code is useless without the verifier, which never leaves this browser and the API |
| `state` | hash in `oauth_attempts`, value in the `investigator_oauth` cookie | CSRF: the callback is believed only with this browser's state, **and** only once (`consumed_at`), **and** within ten minutes |
| `nonce` | hash in `oauth_attempts`, value sent to Google | The ID token must carry it, so a token minted for another sign-in is refused |
| Code exchange | the API only | The client secret is used in one place and reaches no browser |
| ID token | `jose` 6.2.12, Google's JWKS | Never trusted on presentation; one algorithm, RS256, so a token cannot pick a weaker one |
| Redirect URI | `GOOGLE_OAUTH_REDIRECT_URI`, validated at boot | Exactly one callback, ending `/api/v1/auth/google/callback`, https outside development — no pattern, no wildcard. `next` is a relative path, checked (`safeReturnTo`), so the callback is no open redirect |
| Scopes | `openid email profile` | Identity only |

`investigator_oauth` is `SameSite=Lax`, httpOnly, ten minutes, path `/api/v1/auth/google`: it has
to come back on Google's top-level redirect, which Strict would drop.

### Leaving the callback: why a page, not a redirect

A redirect from the callback inherits Google's cross-site context, and a `SameSite=Strict` cookie
set on that response is **not** sent on the page the redirect lands on — verified in the browser
(T-062). So the callback answers `200` with a page that navigates on by meta refresh: a navigation
started on the app's own site, which sends the session. No script, `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` (the callback's address carries the code), and a CSP of
`default-src 'none'`.

## Accounts and identities

`user_identities` holds `(provider, provider_account_id)` — Google's `sub`, never the address —
unique across the platform, and at most one Google identity per account.

| Callback finds | Outcome |
|---|---|
| A linked identity, account usable | Signed in; `last_used_at` noted |
| A linked identity, account suspended or deleted | Refused (`failed`) |
| No identity, Google has **not** verified the address | Refused (`unverified`) — it neither creates nor joins an account |
| No identity, an account has the address, **both** addresses verified, account ACTIVE, no other Google link | Linked (`auth.identity.linked`, `verified_email`), signed in |
| No identity, an account has the address but its own address is unconfirmed, or it has another Google link | Refused (`exists`): sign in with the password, then connect Google from Account |
| No identity, no account | A **waiting sign-up** — no account yet |

**Why both sides verified.** An unverified Google address lets anyone who can make a Google account
for an address take over the account here; an unconfirmed account here lets anyone who registered
someone else's address first inherit that person's Google sign-in. Linking needs neither to be
possible. The test that proves the first — `cannot join an account on an address Google has not
confirmed` — is in `auth-oauth.service.spec.ts`.

### A first sign-in

Nothing is created at the callback. The attempt records who Google said this is, and a second secret
goes to the browser as `investigator_signup` (Strict, httpOnly, thirty minutes). `/sign-up/google`
shows the address and the documents registration requires; `POST /auth/google/complete` creates the
account, the identity and the consent rows **in one transaction** (`legal-consent`) — refused
documents leave the sign-up open to retry, and a completed one cannot be completed again. The
account is `ACTIVE` with its address confirmed, because Google confirmed it, and has no password.

### Connecting and disconnecting

`GET /auth/google/link` (signed in) makes the attempt a LINK for that account; the callback links
whichever Google account the holder chose — an explicit, authenticated action, so no address has to
match (`account_holder`). One held by another account, or a second one, is refused (`taken`).
`DELETE /auth/identities/:id` disconnects — never the last way in: with no password and no other
identity it answers `422 error.validation.identity.last_method`, and a password can be added through
"Forgot your password?". Both are audited; so is every refused callback, with our own reason
(`google:state_mismatch`, `google:email_unverified`, …) and never a code, token or state.

### Deleting an account

`user_identities` cascades from `users`, so erasing an account removes its Google link; a
soft-deleted or suspended account is refused sign-in by Google as by password.

## Configuration

`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` — all three or
none, checked at boot. Without them `GET /auth/providers` says `{ google: false }`, the app offers
no Google button, and the Google routes answer 404. Locally the `api` launch entry loads
`.env.local` with `--env-file-if-exists`.

## Retention

`oauth_attempts` rows are deleted a day after they lapse, at the next start
(`docs/compliance/retention.md`). The provider address in a waiting sign-up is personal data held
at most thirty minutes plus that day.

## Not built

- Google's branded button (the "G" mark). The button is text; Google's branding guidelines prefer
  the mark, and publishing the OAuth app beyond testing users may ask for it.
- Other providers. `identity_provider` is an enum with one value; a second is a migration and a
  client, and the linking rules above apply unchanged.
