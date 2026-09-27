# The client's address

<!-- not-for-ingestion -->

Every per-IP rate limit (sign-in, registration, password reset), every audit row and every consent
record takes the client's address from Express's `req.ip` (`common/http/request-context.ts`). Behind
proxies that is only the client's if the API believes `X-Forwarded-For` from exactly the hops in
front of it, and from nobody else (T-138). Before T-138 it believed nobody: every request carried
Caddy's address, so twenty failed sign-ins anywhere locked every user out, and audit rows could not
tell one client from another.

## The hops

```
browser ──► Caddy ──► API                          (/api/* on app. and admin.)
browser ──► Caddy ──► app-web / admin-web ──► API  (their server-side reads, API_INTERNAL_URL)
```

| Hop | Sets | Trusts |
|---|---|---|
| Caddy | `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` on every proxied request (Caddy's defaults) | An incoming `X-Forwarded-For` only from a peer in `trusted_proxies` (`private_ranges`, Caddyfile global options). A browser is not one, so whatever a client sends is replaced by the address Caddy saw |
| app-web, admin-web | Pass the `X-Forwarded-For` Caddy gave them on to the API (`serverApi`), and nothing else | Caddy — they are reachable only through it |
| API | — | `TRUSTED_PROXIES`: exactly Caddy's, app-web's and admin-web's addresses. Express walks `X-Forwarded-For` from the right over those, and the first address that is not one of them is the client |

## Configuring it

`TRUSTED_PROXIES` is a comma-separated list of addresses, CIDR ranges, or `loopback`
(`config/env.schema.ts`):

- **Required in staging and production.** The API refuses to boot without it there.
- **Refused at boot:** `true`, `*`, a hop count, `0.0.0.0/0`, `::/0`, `uniquelocal` — anything that
  would let a client name its own address, and with it its own rate-limit key.
- **Unset locally** trusts nobody, which is right with nothing in front.

The addresses must be the proxies' own. In Docker Compose, give Caddy, app-web and admin-web fixed
addresses on the internal network (`ipv4_address`) and list exactly those — not the network's range,
which also holds PostgreSQL, Redis and the workers. The API's port is never published: a client that
could reach it directly, from a trusted address, could write its own `X-Forwarded-For`.

## Checking it

- A sign-in audit row records the client: `SELECT ip_address FROM audit_logs WHERE action =
  'auth.login.failed' ORDER BY occurred_at DESC LIMIT 5;` — public addresses, not the proxy's.
- `request-context.e2e.spec.ts` holds it: two clients behind one proxy get separate sign-in limits,
  and the audit row carries the client's address. `bootstrap.spec.ts` holds that a client-written
  `X-Forwarded-For` is not believed.
