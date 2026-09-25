# admin-web — the staff console's web foundation

The platform staff console on `admin.`: a separate application on a separate origin, so a staff
session cookie is unreachable from the customer app (ADR-0002, ADR-0004). Built in T-014 on the
pattern `app-web` set in T-091 — read `app-web.md` first; this note records only what is the same
by reference and what differs.

**Who uses it (ADR-0011).** Platform staff only. Agency owners and admins work in `app-web`: their
authority is a tenant permission, not a platform staff scope, and it never reaches this origin.

## The same as app-web

- **Stack, as pinned.** Next.js 15.5.25 (App Router, `src/`), React 19.2.8, Tailwind 4.3.3,
  Vitest 4.1.11 with Testing Library on jsdom, 100% coverage gate.
- **Tokens.** `src/app/globals.css` imports `@investigator/ui-tokens/tokens.css`, the one token
  source. Light and dark follow the device (`prefers-color-scheme`); durations are zero under
  reduced motion; Tailwind's own palette and scales do not exist.
- **No raw values in feature code.** The root ESLint rule that refuses hex and functional colours,
  numeric arbitrary values and raw durations covers `apps/admin-web/src/**`, with Next.js's
  `core-web-vitals` rules.
- **Never indexed.** `robots: noindex, nofollow` in the root metadata and an `X-Robots-Tag` header
  on every response; no browser source maps; no `X-Powered-By`.
- **Bundle budget.** ≤ 250 kB initial JS (gzip) per route. `pnpm --filter admin-web budget` runs the
  shared `scripts/check-bundle-budget.mjs` against the build; CI runs it after `pnpm build`.
  Recorded at T-014: 102.7 kB for `/`.
- **Strings behind typed keys** (`src/i18n/messages.ts`), English only for now; `t(key, values)`
  fills `{name}` and English's two plural forms, and `has()` checks an API `messageKey`.

## Components and the shadcn pipeline

`components.json` is per app, with the registries in ADR-0003's order: `@shadcn`, `@cult-ui`,
`@react-bits`. There is no root `components.json` any more. Add a component to this app from the
repository root with the pinned CLI:

```bash
pnpm dlx shadcn@4.21.0 add @shadcn/<name> -c apps/admin-web
```

Then read the diff (`component-discovery`). Adding `@shadcn/button` in T-014, CLI 4.21 again wrote
`import { cn } from "cn"` and installed the third-party `cn` package, and installed the unpinned
`radix-ui` umbrella (73 packages) for the one `Slot` the button uses. Both were replaced: `cn` from
`@/lib/utils`, and `@radix-ui/react-slot` pinned at the version the umbrella ships.

**`Button`** (`src/components/ui/button.tsx`) is the first adopted component. Re-tokenised: focus is
the app's single `:focus-visible` outline from the focus-ring token (upstream removed it with
`outline-none`); no `dark:` overrides; every size is at least 44px tall. The filled variants' hover
tint (90% over the surface) is not a colour role, so a spec measures it against WCAG AA in both
themes (lowest: 5.53:1). `hover:` applies only on devices that can hover.

## Signing in, and who gets in (T-070)

`/sign-in` posts to the API's own `POST /auth/login`, same-origin at `/api` — Caddy routes
`admin.<domain>/api/*` to the API, and `next.config.ts` rewrites it in development. The API sets its
session cookie **on this host** (no `Domain`, ADR-0002), so a console session is never the app's, and
no auth code changed. Every refusal reads the same; `next` goes through `safeNext`. Sign-out is the
API's `POST /auth/logout`, which clears the cookie on this origin.

`(console)/layout.tsx` reads `GET /me` (forwarding only the session cookie, uncached): no session →
`/sign-in?next=` (the middleware passes the path as `x-pathname`); signed in without `STAFF` → a
"staff only" page with sign-out. **Scopes are the API's decision**: `/me` does not list them, and a
queue the reader lacks the scope for answers 403, which the screen shows as "you do not have the …
scope" rather than an empty list. `/` redirects to `/verification`, the one queue.

**In development**, `localhost` cookies ignore the port, so the console (3002) and the app (3000)
share one session; deployed, the hosts differ and they never do.

## The shell

One bar — the console's name, its queues (Verification), who is signed in, sign-out — that wraps on
a phone. One queue, so no sidebar and no menu hiding it; the shell grows navigation with the second
queue.

## Verification (T-070)

- **Queue** `/verification` — `GET /verification/requests`, oldest first, as cards (each opens the
  application), dated in the reviewer's time zone (`users.timezone`); "Next applications" and "Back
  to the oldest" by cursor; a cursor that no longer fits starts again from the oldest.
- **Application** `/verification/[id]` — status; the applicant's headline and profile status; **the
  declaration as recorded on the application** (`declaredScope`), specialties named from
  `GET /taxonomy` (a node retired since is shown as such, not dropped); documents; the decision; the
  full trail, this application marked. 404 (or a malformed id) is Next's not-found; 403 is the
  no-scope state.
- **Documents** open only through `GET …/documents/:assetId/delivery-url`, which records the opening.
  A tab is opened on the click (a popup after an `await` is blocked), cut off (`opener = null`), and
  sent to the link; the link is never rendered, kept in state or cached, and a refused link closes the
  tab. A blocked tab asks for no link at all. Only CLEAN documents offer the button; PENDING, INFECTED
  and FAILED say why not.
- **Decision** — a `Drawer`, bottom on a phone and right from `md`: Approve or Reject (native radios,
  required) and a reason (required; spaces alone refused before sending), then the page is read
  again. A 409 says someone else decided it. The reviewer's own application shows a notice instead of
  the form, since the API refuses it.

**Granting staff access** has no screen or command yet (T-149, which needs approval: it is
authorization). For local development only, as the database owner:

```sql
INSERT INTO user_roles (user_id, role) SELECT id, 'STAFF' FROM users WHERE email = 'you@example.test';
INSERT INTO user_staff_scopes (user_id, scope, granted_by)
  SELECT id, 'VERIFICATION', id FROM users WHERE email = 'you@example.test';
```

## Running it

```bash
pnpm --filter @investigator/ui-tokens build   # the app imports the tokens package's build
pnpm --filter @investigator/admin-web dev     # http://localhost:3002
```

Port 3002: app-web is 3000 and the API 3001.

## Not built here

- Every queue after verification — moderation (T-051), disputes, payments — and the navigation
  that a second queue will need.
- Staff access management — T-149.
- A theme toggle and an app icon — as in app-web.
