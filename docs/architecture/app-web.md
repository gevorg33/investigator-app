# app-web — the application's web foundation

The customer, investigator and agency workspace on `app.` (ADR-0002, ADR-0004). Built in T-091.
It is the first real Next.js app in the monorepo, so it sets the pattern `admin-web` (T-014) and
`marketing-web` follow. Procedures: `ui-architecture`, `design-system`, `responsive-design`,
`component-discovery`, `visual-qa`, `frontend-performance`.

## Stack, as pinned

Next.js 15.5.25 (App Router, `src/` directory), React 19.2.8, Tailwind CSS 4.3.3 through
`@tailwindcss/postcss`, shadcn/ui (`components.json`), `lucide-react` icons. Tests: Vitest 4.1.11 +
Testing Library on jsdom; JSX is compiled by Vite's own transform, so there is no React plugin.
Versions follow CLAUDE.md's rule — the newest that has been out long enough, not the newest
published.

## Tokens first: `packages/ui-tokens`

One source for every surface. `src/tokens.ts` holds colour roles for light and dark, the type
scale, spacing unit, radii, shadows, motion durations and easings, z-index layers and breakpoints.
It is the only file in the product where a raw colour, length or duration may be written.

`tokens.css` is generated from it (`pnpm --filter @investigator/ui-tokens tokens:css`) and
committed; a test fails when the two disagree. The stylesheet:

- declares each role at `:root` and swaps it under `prefers-color-scheme: dark`. **The device
  setting decides the theme**; nothing is stored and there is no toggle yet.
- sets every duration to `0ms` under `prefers-reduced-motion`, so a transition becomes an instant
  state change and nothing it communicated is lost.
- **resets Tailwind's own palette and scales** (`--color-*`, `--text-*`, `--radius-*`,
  `--shadow-*`, `--ease-*`, `--breakpoint-*`). `bg-red-500` or `shadow-2xl` do not exist to be
  reached for.
- exposes the roles as utilities through their variables: `bg-surface-raised`,
  `text-text-muted`, `border-border-control`, `ring-focus-ring`.
- maps shadcn's colour names onto our roles (`SHADCN_COLORS`), so a component copied from the
  registry resolves to our palette without an edit. **Trap:** shadcn's `accent` is a hover tint;
  our brand colour is `primary`, and shadcn `accent` maps to `primary-subtle`.

Tokens without a Tailwind namespace are used through their variable: `z-(--z-nav)`,
`duration-(--duration-fast)`.

**Contrast is tested, not asserted.** `CONTRAST_PAIRS` lists every foreground/background pairing
the UI makes, and a test measures each against WCAG AA in both themes (4.5:1 text, 3:1 control
boundaries and focus). A new pairing is added there first.

The font is the platform's own system stack: no download, no layout shift while a font loads, and
Armenian and Cyrillic coverage that most web fonts lack.

## No raw values in feature code — enforced

The root ESLint config, for `apps/app-web/src/**`, refuses a hex or functional colour, an
arbitrary Tailwind value containing a number (`w-[13px]`, `bg-[#f00]`), a bare `duration-200`, and
a literal `150ms`. Arbitrary *variants* (`[&_svg]:size-6`) and token references (`z-(--z-nav)`)
pass. Next.js's `core-web-vitals` rules run on the same files.

## The shell

`src/components/shell/`: authored for the phone first.

| Width | Navigation |
|---|---|
| base (phone) | A fixed bottom bar with all five destinations, labelled, 64px tall, padded for the home indicator (`pb-safe`). Content clears it (`pb-bottom-nav`) |
| `md` and up | A sticky full-height sidebar, 240px, items 44px tall; the bar goes |

The destinations are data (`destinations.ts`): Home, Missions, Messages, Assistant, Account — the
core loop's places. The current one is marked with `aria-current="page"` and visibly by more than
colour (an indicator bar on phones, a tinted shape in the sidebar). A skip link leads to `main`.
Full height is `dvh`; the viewport is `viewport-fit=cover`.

**Every destination except the frame is a placeholder.** Each route renders its title and an empty
state saying what will appear there; the screens are built by their own tasks (T-127 account,
T-056 assistant, the core-loop hiring and messaging tasks).

## Strings

Keys only, even here (localization skill). `src/i18n/messages.ts` holds the shell's English strings
behind typed keys — an unknown key is a type error. T-128 replaces the module with the en/ru/hy
catalogs and the parity check; the keys carry over.

## Never indexed

`robots: noindex, nofollow` in the root metadata **and** an `X-Robots-Tag` header on every response
from `next.config.ts`. Browser source maps are off (T-028's check runs on the build output).

## Components

`components.json` sets the registries in ADR-0003's order: `@shadcn`, `@cult-ui`, `@react-bits`.
It is per app — the root file was removed in T-014, and the shadcn MCP is started inside this app
(`component-discovery`).
Adopted components live in `src/components/ui/` and are recorded in
`docs/product/component-inventory.md`. After every `shadcn add`, read the diff: CLI 4.21 wrote
`import { cn } from "cn"` and installed shadcn's new two-day-old `cn` npm package instead of using
our `@/lib/utils` alias. Our `cn` is plain `clsx` + `tailwind-merge`, which already merges the
token names correctly (`shadow-raised` then `shadow-overlay` keeps the second); a test keeps
checking that across upgrades.

## Performance

Budget (frontend-performance): initial JS ≤ 250 kB gzipped per route, LCP ≤ 2.5 s, CLS ≤ 0.1,
INP ≤ 200 ms. `pnpm --filter app-web budget` measures every route's initial JavaScript from the
build manifest and fails over budget; CI runs it after the build. The script is shared with
admin-web (`scripts/check-bundle-budget.mjs`, run from the app's directory).

Recorded at T-091 on the production build, at 375px with Slow 4G and a 4× CPU slowdown:

| Route | Initial JS (gzip) | LCP | CLS |
|---|---|---|---|
| `/` (cold cache) | 119 kB | 476 ms | 0 |
| `/missions` (shared chunks cached) | 119 kB, 1.8 kB transferred | 224 ms | 0 |

INP is not yet meaningful: the only interactions are links.

## Running it

```bash
pnpm --filter @investigator/ui-tokens build   # the app imports the tokens package's build
pnpm --filter @investigator/app-web dev       # http://localhost:3000
```

`pnpm build` at the root builds the tokens first. `next-env.d.ts` is generated and gitignored.

## Not built here

- A theme toggle — the system setting decides until a user asks otherwise.
- An app icon: the favicon request 404s until there is a brand mark to use.
- Authentication, the workspace switcher and every real screen — T-127, T-092 and the core-loop
  tasks.
