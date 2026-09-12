# Caddy edge configuration

Architecture: `docs/architecture/ADR-0002-domain-architecture.md`
Working rules: `.claude/skills/domain-and-seo/SKILL.md`
DNS and email: `dns-and-email.md`

## Validate before deploying

The Caddyfile has not been validated by Caddy itself — Docker was unavailable when it was
written. Run this before first deploy:

```bash
docker run --rm -v "$PWD":/etc/caddy:ro \
  -e DOMAIN=mydomain.com -e APP_HOST=app.mydomain.com \
  -e ADMIN_HOST=admin.mydomain.com -e NEWS_HOST=news.mydomain.com \
  -e ACME_EMAIL=ops@mydomain.com \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile
```

## Environment

| Variable | Example |
|---|---|
| `DOMAIN` | `mydomain.com` |
| `APP_HOST` | `app.mydomain.com` |
| `ADMIN_HOST` | `admin.mydomain.com` |
| `NEWS_HOST` | `news.mydomain.com` |
| `ACME_EMAIL` | address for certificate notices |

Upstreams are container names: `marketing-web:3000`, `app-web:3000`, `admin-web:3000`,
`api:3001`, `news-web:3000`.

## What this file guarantees

- **`app.` cannot be indexed.** `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet` is
  set at the edge on every response, so no application route can forget it. Crawling is
  permitted on purpose — a blocked crawler never sees the header, and an externally linked
  URL could still be indexed.
- **The API is same-origin** at `app./api`, which is what makes `SameSite=Strict` session
  cookies viable.
- **Authenticated responses are `no-store, private`** so no shared cache retains them.
- **Marketing redirects authenticated paths** to `app.` permanently, so they cannot return
  200 on the indexable origin.
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

1. Add it to the domain map in `packages/config`.
2. Add a site block here. **Set `X-Robots-Tag` explicitly** — decide indexable or not rather
   than inheriting a default.
3. Confirm it receives no session cookie.
4. If it sends email, give it its own sending domain and DKIM key.
