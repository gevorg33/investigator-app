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
- **Strings behind typed keys** (`src/i18n/messages.ts`), English only for now.

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

## The landing page

One route, `/`: what the console is for, and a **disabled** Sign in button, because staff sign-in
does not exist yet — it arrives with the verification console (T-070). Disabled rather than a control
that does nothing.

## Running it

```bash
pnpm --filter @investigator/ui-tokens build   # the app imports the tokens package's build
pnpm --filter @investigator/admin-web dev     # http://localhost:3002
```

Port 3002: app-web is 3000 and the API 3001.

## Not built here

- Staff sign-in, the navigation shell and every queue — T-070 (verification) and the console
  tasks after it. The shell will be designed with the first real screen, not ahead of it.
- A theme toggle and an app icon — as in app-web.
