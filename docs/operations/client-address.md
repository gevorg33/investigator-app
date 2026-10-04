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
| Caddy | `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host` on every proxied request (Caddy's defaults) | Nobody: no `trusted_proxies`, so whatever a client sends is replaced by the address Caddy saw (T-023). It trusted `private_ranges` until then, which kept a client's own entry whenever Docker relayed the connection from the bridge gateway |
| app-web, admin-web | Pass the `X-Forwarded-For` Caddy gave them on to the API (`serverApi`), and nothing else | Caddy — they are reachable only through it |
| API | — | `TRUSTED_PROXIES`: exactly Caddy's, app-web's and admin-web's addresses. Express walks `X-Forwarded-For` from the right over those, and the first address that is not one of them is the client |

## Configuring it

`TRUSTED_PROXIES` is a comma-separated list of addresses, CIDR ranges, or `loopback`
(`config/env.schema.ts`):

- **Required in staging and production.** The API refuses to boot without it there.
- **Refused at boot:** `true`, `*`, a hop count, `0.0.0.0/0`, `::/0`, `uniquelocal` — anything that
  would let a client name its own address, and with it its own rate-limit key.
- **Unset locally** trusts nobody, which is right with nothing in front.

The addresses must be the proxies' own. `infrastructure/compose/server.yml` (T-023) gives Caddy,
app-web and admin-web fixed addresses on the internal network — `10.20.0.2`, `.3`, `.4` — and sets
the API's `TRUSTED_PROXIES` to exactly those, in the compose file rather than the environment file,
so the two cannot drift. Not the network's range, which also holds PostgreSQL and Redis. Docker
hands out other containers' addresses from `10.20.0.128/25` only (`ip_range`): without it,
PostgreSQL took `10.20.0.2` before Caddy started, and a container holding a proxy's address is one
whose `X-Forwarded-For` the API believes. The API's port is never published: a client that could
reach it directly, from a trusted address, could write its own `X-Forwarded-For`.
`apps/api/test/edge.spec.ts` holds all of this against what Compose resolves.

## A known gap: connections Docker relays

Caddy sees the real client only when Docker forwards a published port by NAT. When Docker relays the
connection through its userland proxy instead, Caddy's peer is the edge network's gateway, and every
such client shares that one address — one sign-in rate limit, one audit address. That happens to
IPv6 clients on a host whose Docker networks are IPv4-only, and to everything under Docker Desktop
or Colima on a laptop (seen in T-023's verification as `172.20.0.1`). It is not spoofable — the
gateway is not in `TRUSTED_PROXIES`, so the API stops there — but it is wrong. Settling it on the
real host is T-201.

## Checking it

- A sign-in audit row records the client: `SELECT ip_address FROM audit_logs WHERE action =
  'auth.login.failed' ORDER BY occurred_at DESC LIMIT 5;` — public addresses, not the proxy's.
- `request-context.e2e.spec.ts` holds it: two clients behind one proxy get separate sign-in limits,
  and the audit row carries the client's address. `bootstrap.spec.ts` holds that a client-written
  `X-Forwarded-For` is not believed.
