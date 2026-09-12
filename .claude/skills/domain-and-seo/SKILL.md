---
name: domain-and-seo
description: Domain boundaries and search-engine optimisation — which subdomain serves what, cookie scoping, sitemap and robots generation, canonical and hreflang, metadata, structured data, and excluding the application from indexing. Use when working on the marketing site, adding a public page, touching auth cookies or CORS, or adding a subdomain.
---

# Domains and SEO

Architecture decided in `docs/architecture/ADR-0002-domain-architecture.md`. This skill is
how to work within it.

## Boundaries

| Name | Serves | Indexable |
|---|---|---|
| `mydomain.com` | Marketing: landing, product, pricing, blog, public policy pages | Yes |
| `app.mydomain.com` | Application + API at `/api`. Auth, dashboards, workflows, assistant | **Never** |
| `admin.mydomain.com` | Staff console — **separate app, separate origin** | **Never** |
| `news.mydomain.com` | Newsletter signup and public archive; management authenticated | Archive only |
| `mail.mydomain.com` | Transactional sending domain. Not a website | N/A |

### Rules that do not bend

1. **No authenticated UI on the marketing domain.** Not a login form, not a "my account"
   widget, not a session check. Marketing links to `app.` for anything requiring identity.
2. **Staff lives on `admin.`, never as a route group inside `app.`** A separate origin is
   what keeps a staff session unreachable from the customer app's XSS surface.
3. **Session cookies are host-only on `app.` and `admin.` separately** — no `Domain`
   attribute, ever. A cookie on
   `.mydomain.com` reaches every subdomain including third-party-heavy ones. This is the
   single most important rule here.
4. **No hardcoded hostnames.** Use the typed domain map from `packages/config`. Code refers
   to `appUrl`, never to a literal string.
5. **The marketing site never links to an authenticated route** in indexable markup. It
   links to `app.` entry points.

## Excluding the application from search

`robots.txt` `Disallow` blocks **crawling**, not **indexing**. A disallowed URL linked from
elsewhere can still be indexed without a snippet, because the crawler was never permitted to
fetch the page and see a `noindex`.

So `app.` sends `X-Robots-Tag: noindex, nofollow` **on every response, at the proxy**, and
permits crawling so the header is seen. Never rely on a per-page meta tag in the application
— one missed route is an indexed dashboard URL.

Never in a sitemap: dashboards, authenticated routes, `/api/*`, auth pages, evidence or
report URLs, signed media links, admin, preview or draft routes, search-result pages,
anything behind a paywall or a role check.

## Sitemap and robots

Generate them. Do not hand-maintain XML — it drifts the moment a page is added, which is
exactly what the requirement is about.

Next.js App Router provides `app/sitemap.ts` and `app/robots.ts` conventions. Build the
sitemap from two sources:

1. **Static routes** — derived from the route manifest, then filtered through an explicit
   allowlist of public segments. Allowlist, never denylist: a denylist fails open, and the
   failure mode is an indexed private route.
2. **Dynamic content** — blog posts and public policy pages, queried at build or revalidate
   time, each contributing `lastModified`.

Every entry needs `loc` and `lastModified`. A sitemap whose `lastModified` never changes is
ignored.

Regenerate on deploy and on content revalidation. A stale sitemap is worse than none.

## Canonical and locale

The marketing site serves `en`, `ru` and `hy`. Each page therefore needs:

- A self-referencing `canonical` for that locale's URL
- `hreflang` alternates for every locale, including `x-default`
- The locale in the URL (`/ru/pricing`), not in a cookie or header

Alternates must be reciprocal — if `/ru/pricing` points at `/pricing`, that page must point
back. One-way alternates are ignored.

Never canonicalise across locales to a single language. That de-indexes the translations.

## Metadata

Every public page has a unique `title` and `description`. Generated boilerplate repeated
across pages is worse than a short specific one.

Open Graph: `og:title`, `og:description`, `og:url` (the canonical), `og:type`, `og:image`
(with dimensions and alt), `og:locale` plus `og:locale:alternate`. Twitter/X:
`twitter:card` (`summary_large_image`), title, description, image.

In Next.js, use the `metadata` export or `generateMetadata`, so it lives with the route.

## Structured data

JSON-LD. Apply only what the page actually is:

| Page | Type |
|---|---|
| Home | `Organization` + `WebSite` with `SearchAction` |
| Service/product pages | `Service` or `ProfessionalService` |
| Public FAQ | `FAQPage` |
| Blog post | `BlogPosting` with author and dates |
| Any nested page | `BreadcrumbList` |

**Only public content may appear in structured data.** The knowledge base is mostly
`visibility: authenticated` — only `docs/knowledge-base/policies/**` is public. Marking up
authenticated FAQ content would publish it. Check `visibility` in the frontmatter before
using any knowledge-base content on the marketing site.

Never mark up content not visible on the page. That is cloaking, and it is penalised.

## URLs and status codes

- Lowercase, hyphenated, descriptive, stable. `/private-investigator-yerevan`, not `/p?id=42`
- No trailing-slash inconsistency — pick one, redirect the other `301`
- A moved page returns `301`. A removed page returns `410` if genuinely gone, `404` otherwise
- A soft 404 — a "not found" page returning `200` — gets the whole site's crawl budget wasted
- Never `302` for a permanent move

## Adding a subdomain

1. Add it to the domain map in `packages/config`, with its role.
2. Add a Caddy block. Set `X-Robots-Tag` explicitly — decide indexable or not, do not default.
3. Confirm it receives **no** session cookie. Adding a name must never widen session scope.
4. If it sends email, give it its own sending domain and DKIM key.
5. Add it to CSP and CORS allowlists **from the config**, not by hand.

## Checklist for a new public page

- [ ] Unique title and description
- [ ] Self-referencing canonical
- [ ] Reciprocal `hreflang` for en/ru/hy plus `x-default`
- [ ] Open Graph and Twitter metadata with an image
- [ ] JSON-LD matching what the page actually is
- [ ] Appears in the sitemap via the allowlist, with a real `lastModified`
- [ ] SEO-friendly URL; correct status codes on any replaced route
- [ ] No authenticated content, no session check, no link into an authenticated route
- [ ] Any knowledge-base content reused is `visibility: public`
