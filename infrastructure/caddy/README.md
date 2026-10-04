# Caddy edge configuration

Architecture: `docs/architecture/ADR-0002-domain-architecture.md`
Working rules: `.claude/skills/domain-and-seo/SKILL.md`
DNS and email: `dns-and-email.md`
Server stack: `../compose/server.yml` — what runs behind this file on staging and production

## Validate before deploying

Caddy itself checks that the file loads and that `caddy fmt` would change nothing, with the image
the server stack pins (read from `server.yml`). CI runs it on every pull request (T-202); run it
from the repository root after every change:

```bash
./scripts/check-caddyfile.sh
```

`apps/api/test/edge.spec.ts` holds the rules below in CI: no hostname in this file, the marketing
redirects land on routes app-web serves, `noindex` on `app.` and `admin.`, no `trusted_proxies`.

## Environment

| Variable | Example |
|---|---|
| `DOMAIN` | `mydomain.com` — required |
| `APP_HOST` | `app.mydomain.com` — defaults to `app.<DOMAIN>` in `server.yml` |
| `ADMIN_HOST` | `admin.mydomain.com` — defaults to `admin.<DOMAIN>` |
| `NEWS_HOST` | `news.mydomain.com` — defaults to `news.<DOMAIN>` |
| `ACME_EMAIL` | address for certificate notices — required |

**These are also the API's variables.** The domain map in `packages/config` (`domains()`,
`appUrl()`) turns the same four names into origins, and the API builds every emailed link from
it, so the edge and the code cannot disagree about a name. `server.yml` hands Caddy and the API
the same values. A malformed host (a scheme, a path, upper case) or two sites on one host fails
the API at boot, naming the variable.

Upstreams are container names: `marketing-web:3000`, `app-web:3000`, `admin-web:3000`,
`api:3001`, `news-web:3000`. **marketing-web and news-web do not exist yet**: until they do, the
apex and `news.` return `502` for anything but the redirects, which run before the proxy.

## Verifying it end to end, without a domain

Names under `.localhost` get certificates from Caddy's own CA, so the whole stack can run on a
laptop. Run `server.yml` with an override that swaps the platform images for a request-echoing
stand-in (`traefik/whoami`) and moves Caddy to loopback ports (`ports: !override`), with
`DOMAIN=investigator.localhost`. Then probe with
`curl --cacert <caddy root> --connect-to ::127.0.0.1:8443 https://app.investigator.localhost/…`;
the root is at `/data/caddy/pki/authorities/local/root.crt` inside the container.

What T-023 saw that way: a verified certificate for every name; `www.` → apex `301` keeping the
path and query; `http` → `https` `308`; every marketing auth path `301` to app-web's route;
`X-Robots-Tag` on `app.` and `admin.`; `/api/*` reaching the API from both origins, with a
client-written `X-Forwarded-For` replaced; immutable caching on `/_next/static/*` and `/fonts/*`
only; PostgreSQL, Redis, the API and the web apps unreachable from the edge network; no route out
from the internal network except the API's own `egress`.

What only a real domain shows: public certificate issuance and DNS. That is the deploy's check
(T-040), with `curl -I https://app.<domain>/` carrying the `X-Robots-Tag`.

## What this file guarantees

- **Caddy is the first hop.** It sets no `trusted_proxies`, so a client's own `X-Forwarded-For`
  is always replaced by the address Caddy saw. Trusting private ranges, as this file once did,
  kept a client's entry whenever Docker relayed the connection from the bridge gateway.
- **`app.` cannot be indexed.** `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` is
  set at the edge on every response, so no application route can forget it. Crawling is
  permitted on purpose — a blocked crawler never sees the header, and an externally linked
  URL could still be indexed.
- **The API is same-origin** at `app./api`, which is what makes `SameSite=Strict` session
  cookies viable.
- **Authenticated responses are `no-store, private`** so no shared cache retains them; only
  content-hashed assets (`/_next/static/*`, `/fonts/*`) are cached, by matchers that exclude each
  other. An unmatched `header Cache-Control` beside a matched one let `no-store` win on the
  assets too, until T-023.
- **Marketing redirects authenticated paths** to `app.` permanently, so they cannot return
  200 on the indexable origin — `/login` and `/sign-in` to `/sign-in`, `/register` and
  `/sign-up` to `/sign-up`, `/dashboard` to `/`.
- **`admin.` is a separate origin**, so a staff session cookie is unreachable from the
  customer app. It also carries a commented IP-allowlist block the customer app could never
  have.
- **`mail.` has no HTTP block.** It is a sending domain.

## What it does not do

- **CSP is not set here.** The marketing site and the application need materially different
  policies, and a wrong CSP breaks the page silently. Set it per-application from the domain
  map in `packages/config` — see T-025.
- **Rate limiting** is in the API, not the edge.
- **Cookie attributes** are set by the application. The edge cannot enforce host-only
  scoping; that rule lives in the auth module and is tested there.

## Adding a subdomain

1. Add it to the domain map in `packages/config` (`SITE`), with its variable — the same one
   this file reads — and to `server.yml`'s `x-domains`.
2. Add a site block here. **Set `X-Robots-Tag` explicitly** — decide indexable or not rather
   than inheriting a default.
3. Confirm it receives no session cookie.
4. If it sends email, give it its own sending domain and DKIM key.
