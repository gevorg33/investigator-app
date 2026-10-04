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
scope" rather than an empty list. `/` redirects to `/verification`.

**In development**, `localhost` cookies ignore the port, so the console (3002) and the app (3000)
share one session; deployed, the hosts differ and they never do. The session cookie is
`__Host-investigator_session` (T-025): the browser refuses it a `Domain`, so a console session can
never be widened to the parent domain, and the app — the same site — cannot write to the console's
API: the API refuses any write whose `Sec-Fetch-Site` is not `same-origin` (`docs/api/README.md`).

**Content-Security-Policy** (T-025): `middleware.ts` sets the console's own, nonce per request,
from `contentSecurityPolicy('admin', …)` — the app's policy without its two providers: no outside
origin at all. The root layout calls `connection()`, so every page renders per request and carries
its nonce; `/` and the not-found page were built ahead of time before, and would have shipped scripts
the browser refused.

## The shell

One bar — the console's name, its destinations (Verification, Missions, Legal holds), who is signed
in, sign-out. On a phone the name and sign-out share the first row and the destinations wrap below
it, full width; from `md` it is one row, where the destinations keep their width and the email gives
way and truncates. Three destinations, so still no sidebar and no menu hiding them. Every one is
listed for every member of staff; whether they may work it is the API's answer, which each page says.
**Not** hidden by scope: `/me` does not list scopes (above), and adding them is an authorization-
visibility change of its own (T-205 kept the console's pattern; see T-187 for the app's equivalent).

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

## Moderation (T-051)

- **Queue** `/moderation` — `GET /moderation/missions`: the most sensitive risk band first, then the
  longest waiting. Each card: band (in words, with a warning mark for HIGH and RESTRICTED), priority
  or routine, the title, how long it has been queued ("Queued 3 hours ago"), the customer's deadline,
  how many rules matched, and its category. Paged by cursor like verification.
- **Mission** `/moderation/[id]` — the brief as submitted, never the customer's identity; the
  screening (band, queue, the rule ids matched, ruleset and when); the **AI classification in its own
  dashed, labelled box**, input only; the tags, each marked "suggested" or "confirmed" (T-055); every decision on the mission across its submissions, the
  reason the customer read set apart from the internal note.
- **Decision** — a `Drawer` like verification's: Publish, Return for changes, Reject, none selected;
  the reason's label and hint follow the outcome ("the customer reads this" on a rejection or a
  return, "staff only" on a publication); an optional internal note. The control is disabled until an
  outcome is chosen and the reason says something. On **Publish** a checklist of the ACTIVE tags
  appears (T-055): the customer's suggestions ticked and first, the rest of the vocabulary after,
  at most eight; the ticked ones are sent as `tagIds` and confirmed. Nothing about tags is sent on
  any other outcome, and a suggestion since retired is not offered. A 409 says someone else decided first. The
  moderator's own mission shows a notice instead of the form; one with no screening record says not
  to decide it.

- **Review times** `/moderation/latency` (T-193), linked from the queue — a card per category and
  risk band: decisions, median wait, "9 in 10 decided within", longest wait, and the outcome mix;
  periods of 30 days, 90 (the default) or a year, the current one marked. Waits read in one unit
  ("45 min", "2.5 hr", "3.2 days"). The page says it is what a decision to open a category would be
  made on, and that nothing opens from it.

## Legal holds (T-205)

`/legal-holds` — COMPLIANCE scope, on T-035's API (`GET|POST /legal-holds`, `POST …/:id/release`).

- **The list**: holds in force by default, newest first; **Released** and **All** as links, the
  current one marked; paged by cursor like the queues, a cursor that no longer fits starting again
  from the newest in the same view. A card per hold on every width: in force or released, the kind of
  record and its full id, why it is held, who placed it and when (in the reader's time zone, the
  person by a short handle); once released, who released it, when and why. There is no page per
  hold — the API reads holds only as a list, and a card already says everything a hold does.
- **Holds on one record**: a lookup (kind and id, a plain `GET` form) narrows the list to one
  record — "is this account held?". An id in capitals or with spaces is still the id; one that is
  not an id, or half a lookup, is said so under the field and the list is not narrowed.
- **Placing** — a `Drawer`: the kind (native radios, none chosen), the id, the reason (at least the
  API's 12 characters, said in the hint: which request, case or instruction, with its reference).
  From a lookup it starts with that record filled in; after placing it starts afresh. A record that
  does not exist is said in words beside the buttons.
- **Releasing** — its own `Drawer` from the card ("Release — Account e18bbb58", so a list of them
  says which is which), saying it cannot be undone, with a reason and a destructive submit. Someone
  having released it first is said beside the buttons, and the sheet stays open.
- Errors in both sheets sit beside the buttons, outside the scrolling body: at the top of a long
  sheet the message was out of view once the reader had scrolled down to submit.
- 403 is the no-scope notice, as for the queues. Shared values (the kinds, the reason bounds) live
  in `src/lib/legal-holds.ts`, not in a sheet: a server component that imports a value from a
  `'use client'` module gets a reference, not the value (`client-boundary.spec.ts` holds that).

Verified in the browser at 1440, 768 and 375, light and dark, with reduced motion (sheet and scrim
not animated, closed in milliseconds): place, not found, lookup, release, a release that lost a race,
no scope, and the keyboard path into, around and out of each sheet.

**Granting staff access** has no screen or command yet (T-152, which needs approval: it is
authorization). For local development only, as the database owner:

```sql
INSERT INTO user_roles (user_id, role) SELECT id, 'STAFF' FROM users WHERE email = 'you@example.test';
INSERT INTO user_staff_scopes (user_id, scope, granted_by)
  SELECT id, 'VERIFICATION', id FROM users WHERE email = 'you@example.test';
-- The moderation queue (T-051) needs its own scope:
INSERT INTO user_staff_scopes (user_id, scope, granted_by)
  SELECT id, 'MODERATION', id FROM users WHERE email = 'you@example.test';
-- Legal holds (T-035, T-205) need COMPLIANCE:
INSERT INTO user_staff_scopes (user_id, scope, granted_by)
  SELECT id, 'COMPLIANCE', id FROM users WHERE email = 'you@example.test';
```

## Running it

```bash
pnpm --filter @investigator/ui-tokens build   # the app imports the tokens package's build
pnpm --filter @investigator/admin-web dev     # http://localhost:3002
```

Port 3002: app-web is 3000 and the API 3001.

## Not built here

- The queues still to come — disputes, payments — and opening mission attachments from the
  moderation page (T-066).
- Staff access management — T-152.
- A theme toggle and an app icon — as in app-web.
