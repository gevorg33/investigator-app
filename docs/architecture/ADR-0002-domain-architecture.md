---
adr: 0002
title: Subdomain split for marketing, application, newsletter and email
status: Accepted
date: 2026-09-12
supersedes: —
superseded_by: —
related:
  - plan.md §3, §4, §24
  - .claude/skills/domain-and-seo/SKILL.md
  - infrastructure/caddy/Caddyfile
---

# ADR-0002 — Subdomain split

**Status:** Accepted · **Date:** 2026-09-12

## Context

The platform has four distinct concerns with different audiences, caching behaviour, deploy
cadence, risk profiles and indexing requirements: a public marketing site, an authenticated
application, a newsletter, and transactional email.

Serving these from one origin under path prefixes couples them: a marketing deploy risks the
application, the CDN cache policy cannot differ meaningfully, and search-engine control
becomes per-path rather than per-origin.

## Decision

Five names, each with a single responsibility:

| Name | Serves | Indexable |
|---|---|---|
| `mydomain.com` | Marketing site (Next.js). Landing, product, pricing, blog, public policy pages. No authenticated UI. | Yes — fully optimised |
| `app.mydomain.com` | The application (Next.js) **and the API under `/api`**. Auth, dashboards, workflows, assistant. | No — `noindex` on every response |
| `admin.mydomain.com` | Staff console. Separate application, separate origin (`plan.md` §1). | No — `noindex` on every response |
| `news.mydomain.com` | Newsletter subscription and public archive. Management routes authenticated. | Archive yes; management no |
| `mail.mydomain.com` | **Not a website.** The sending domain for transactional email. | N/A |

`www.mydomain.com` permanently redirects to the apex.

## Two decisions the original requirement did not cover

### The API lives at `app.mydomain.com/api`, not `api.mydomain.com`

Same-origin with the application front-end. This is deliberate:

- No CORS preflight on every authenticated request
- `SameSite=Strict` cookies become viable; a separate API origin forces `SameSite=None`,
  which is a materially weaker position for a platform holding evidence
- One fewer certificate, one fewer origin in the CSP, one fewer thing to misconfigure

Caddy routes `/api/*` to the NestJS service and everything else to the Next.js application.
Splitting the API onto its own name later is a routing change, not an application change.

### `mail.mydomain.com` is a sending domain, not a subdomain to deploy

Transactional email is DNS and an email provider: SPF, DKIM and DMARC records, and a
provider configured to send as that domain. No HTTP service is deployed there.

**Transactional and newsletter mail must not share a sending domain.** Newsletters attract
complaints and unsubscribes; transactional mail must reach the inbox. Sharing reputation
means a bad campaign degrades password-reset and verification delivery — which is an
availability and account-recovery problem, not a marketing one.

- `mail.mydomain.com` — transactional only, separate DKIM key
- a distinct newsletter sending domain for `news.` — separate DKIM key, separate reputation

The apex domain should not send mail at all, so its reputation stays clean for future use.

### Staff is a separate origin, not a route group

`admin.` exists so that a staff session cookie is unreachable from the customer application.
Combined with host-only cookies below, an XSS in `app.` cannot reach a session that can read
evidence across all assignments or act on payouts. It also lets `admin.` be IP- or VPN-gated
at the edge, which `app.` never could be.

## Cookie scoping — the security-critical part

**Session cookies are set host-only on `app.mydomain.com`, with no `Domain` attribute.**

A cookie scoped to `.mydomain.com` is transmitted to every current and future subdomain. An
XSS or a compromise on the newsletter platform — a lower-value, likely third-party-heavy
surface — would then expose application session cookies.

The parent domain never receives a session cookie. This is the single most important
constraint in this ADR, and it is enforced in configuration, not by convention.

It follows that a future subdomain cannot silently inherit the session. That is intended: a
new origin needing authentication goes through a deliberate token exchange, not ambient
cookie sharing. Adding a subdomain must never widen session scope as a side effect.

## Search-engine exclusion

`robots.txt` `Disallow` prevents **crawling**, not **indexing**. A disallowed URL linked from
elsewhere can still appear in results, without a snippet, because the crawler was never
allowed to fetch the page and see a directive.

Therefore `app.mydomain.com` sends **`X-Robots-Tag: noindex, nofollow` on every response**,
at the proxy, so it cannot be forgotten in application code. Its `robots.txt` permits
crawling so the header is actually seen.

Belt and braces: the header at the edge, plus a restrictive `robots.txt`, plus no inbound
links from the marketing site to authenticated routes.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Single origin, path prefixes (`/app`, `/news`) | Couples deploys and caching; search control becomes per-path; a marketing rebuild risks the application |
| `api.mydomain.com` separate | Forces CORS and `SameSite=None`; weaker cookie posture for no gain at this scale |
| Cookies on `.mydomain.com` for future SSO | Exposes app sessions to every subdomain including third-party-heavy ones. Unacceptable for a platform holding evidence |
| Marketing on a separate root domain | Loses the SEO value of one authoritative domain; complicates brand and certificates |

## Consequences

**Accepted:**
- Four names and their DNS, certificates and monitoring to maintain
- No ambient session sharing across subdomains; cross-origin auth needs a deliberate flow
- Two sending domains and two DKIM keys to configure and monitor

**Gained:**
- Marketing deploys, caches and scales independently of the application
- Application is excluded from indexing at the edge, not per-page
- A newsletter incident cannot affect transactional email delivery
- A compromise of the newsletter platform does not reach application sessions
- New subdomains are a Caddy block plus a DNS record — no application change

## Making future subdomains cheap

1. Hostnames are **never hardcoded**. `packages/config` exports a typed, environment-driven
   domain map; application code refers to roles (`marketingUrl`, `appUrl`), not strings.
2. Caddy configuration is per-environment and additive — a new name is a new block.
3. The allowed-origin list for CORS and CSP is derived from that config, not hand-maintained.
4. Host-only cookies mean adding a name cannot widen session scope.

## Revisit this when

- The API needs independent scaling or a separate deploy cadence, making `api.` worth its CORS cost
- A second authenticated surface genuinely needs shared sign-on, requiring a deliberate SSO design
- Marketing outgrows Next.js rendering and needs a CMS-hosted origin
