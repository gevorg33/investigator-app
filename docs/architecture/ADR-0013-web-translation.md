---
adr: 0013
title: Translating the web apps — use-intl, typed catalogs, locale without URL segments
status: Accepted
date: 2026-09-24
supersedes: —
superseded_by: —
related:
  - .claude/skills/localization/SKILL.md
  - docs/architecture/app-web.md
  - packages/i18n
---

# ADR-0013 — Translating the web apps

**Status:** Accepted · **Date:** 2026-09-24 · **Task:** T-128

## Context

The launch market reads English, Russian and Armenian. The localization skill requires keys, never
literals; ICU plurals (Russian has four categories, Armenian two, English two); a build that fails
on a missing key; English fallback that is reported and never shows a raw key; and dates, numbers
and money formatted at render time in the reader's locale and time zone.

The application (`app.`) is never indexed (ADR-0002), so locale does not need to be in the URL for
search engines.

## Decision

### Library: `use-intl`, not `next-intl`

`use-intl` is the framework-agnostic core that `next-intl` wraps. It gives ICU MessageFormat, typed
keys, `createTranslator` for server components and `IntlProvider` / `useTranslations` for client
components — everything used here.

`next-intl` 4.14 adds locale routing, middleware and message-extraction tooling, and ships the
latter as runtime dependencies: `@swc/core` and `@parcel/watcher`, both native binaries with
install scripts that this repository's `allowBuilds` policy denies by default. None of it is needed
without locale URLs. Adding it would mean native install scripts for features we do not use.

Rejected: a hand-rolled ICU parser (reuse before building); `intl-messageformat` alone (what
`use-intl` already wraps, minus the React integration we would then write ourselves).

### Catalogs: typed TypeScript in `packages/i18n`

`en.ts` is the source. `ru.ts` and `hy.ts` are typed `Catalog` — English's keys with string
values — so **a missing, extra or misplaced key is a compile error** and `pnpm build` fails
(`packages/i18n` builds before the apps). A test adds what types cannot see: every message is valid
ICU, uses the same arguments as English, and covers every plural category its language has.
Framework-free, so admin-web, marketing-web and a revived mobile companion share one source.

### Locale: the reader's choice, then the browser, then English

`resolveLocale`: the `locale` cookie (the reader's choice — host-only, HTTP-only, `Secure`, a
year), else `Accept-Language` by weight, else `en`. **No locale segment in the URL**: nothing to
index, and a shared link opens in the recipient's language rather than the sender's. When accounts
arrive (T-127), a signed-in user's saved language is written to the same cookie.

**Across the domain boundary.** The marketing site keeps its locale in the URL (`/ru/pricing`,
domain-and-seo) and cannot set a cookie on `app.`. Its links into the app append `?lang=<locale>`:
middleware records that as the reader's choice and redirects (303) to the same URL without the
parameter, so it is never bookmarked, shared or logged with the page. An unknown value is dropped
and changes nothing. Anyone can link with `?lang=`, which changes only the language shown — visible
and one tap to undo, like the control itself.

### Fallback

A missing key cannot reach runtime. A message that fails to format — bad arguments from calling
code — is reported (`[i18n] CODE (locale): …`, never the values) and replaced by the English text;
if that too is unavailable, by nothing, never by the key.

### What reaches the browser

Server components translate on the server. Client components get only the namespaces they use
(`CLIENT_NAMESPACES` in the root layout — today `nav`), so the browser does not download the
catalog.

## Consequences

**Gained:** one source of strings for every surface; missing translations fail CI rather than a
reader; correct Russian plurals by construction; no native install scripts.

**Accepted:** pages read a cookie, so they render per request rather than statically — the app is
per-user anyway. `use-intl`'s client code adds about 11 kB gzipped (app-web: 131 kB of the 250 kB
budget). Translations are written by an agent and **not yet reviewed by native speakers**
(ACTIONS-FOR-ME #23); the catalogs are usable, not final.

**Not decided here:** per-user time zone storage (T-127 — the formatters require a time zone and
default to none); translating API error codes (T-135 adds them to these catalogs).
