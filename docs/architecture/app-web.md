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

`scrim` (T-054) dims the page behind a sheet — dark in both themes, always used with an opacity
(`bg-scrim/50`), never as text; the contrast test treats it as a background.

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
colour (an indicator bar on phones, a tinted shape in the sidebar). The Assistant is not a page: it
is a button that opens the assistant where the reader is (`aria-expanded`, marked like the current
page while open) — see "The assistant" below. A skip link leads to `main`.
Full height is `dvh`; the viewport is `viewport-fit=cover`.

**Account, the assistant and, for investigators, Missions are real; the rest are placeholders.**
Each placeholder renders its title and an empty state saying what will appear there; the screens are
built by their own tasks (the core-loop hiring and messaging tasks). Above every screen the shell shows what the account still
owes — an unconfirmed address, documents to accept — as notices linking to where each is settled
(`AccountNotices`). Notices, never blocks.

## Strings and locale

Every user-facing string is a key in `packages/i18n` (ADR-0013). Server components translate with
`getT()` from `src/i18n/server.ts`; client components with `useTranslations` under the provider the
root layout mounts, which receives only `CLIENT_NAMESPACES` (`nav`, `missions`, `assistant`,
`auth`, `account`, `legal`, `error`). Keys are typed against the catalog shape — `t('nav.misions')` is a compile error.

The locale is the `locale` cookie (set by the language choice: host-only, HTTP-only, `Secure`, a
year), else `Accept-Language`, else English. Signed in, choosing a language also saves it to the
account (`PATCH /me/preferences`), and signing in writes the account's saved language back into the
cookie — so the language someone chose follows them to every device, and agrees with `users.locale`,
which the API's assistant reads. A link into the app may carry `?lang=ru` (the
marketing site's handoff): `src/middleware.ts` turns it into the reader's choice and redirects to
the URL without it. `<html lang>` and every title follow it. No
locale in the URL: the app is never indexed. A message that fails to format is reported and shown in
English — never as its key.

ESLint refuses JSX text, string children and literal `aria-label` / `title` / `alt` /
`placeholder` in `apps/app-web/src/**` (specs excepted). Numbers, dates and money go through the
formatters in `@investigator/i18n`, which require a time zone.

**Bottom-bar labels must fit a 75px tab at 12px** (about 60px of text) in every language. Russian
«Сообщения» and Armenian «Պատվերներ» did not; the catalogs use «Чаты» and «Գործեր». Check any new
or changed nav label at 375px. Product terms in each language: `docs/product/translation-glossary.md`.

## Accounts: signing up, in and out (T-127)

Signed-out screens live in the `(auth)` route group — one column, no navigation, the language
choice in the footer (a language has to be choosable before there is an account to choose it in).
Everything in `(workspace)` requires a session: its layout reads `GET /me` and, with no session,
redirects to `/sign-in?next=<the page asked for>`. The middleware passes that path to server
components as `x-pathname`, always overwriting whatever a client sent.

**Two ways to reach the API, one owner of the cookie.** The API sets and clears the session cookie
(`investigator_session`: HTTP-only, `SameSite=Strict`, host-only, `Secure` outside development —
T-025). So every mutation — sign in, up, out, verify, reset, add a role, accept documents, save a
time zone — is a browser `fetch` to the same-origin `/api/v1` (`lib/api/browser.ts`): the API's own
`Set-Cookie` lands in the browser and nothing here copies its attributes. Server components read
through `lib/api/server.ts`, which forwards only the session cookie and the chosen role
(`X-Active-Role`, which the API only ever narrows by), with `cache: 'no-store'`. In development
Next rewrites `/api/*` to the API (`API_INTERNAL_URL`, default `http://localhost:3001`); in
production Caddy routes it. Errors arrive in the API's contract shape and are shown by their
`messageKey`, translated — never the raw key, never an English sentence from the API.

| Screen | What it does |
|---|---|
| `/sign-up` | Email, password, and the documents registration requires, read in full in place and accepted with one checkbox. The documents come from `GET /legal/required?for=registration&locale=…` — which ones is the API's policy (`legal.policy.ts`), never a list here — and their ids are posted back as `acceptedDocumentIds`, so what is recorded is exactly what was shown, in the language shown. The screen's language and the device's time zone are saved on the account. Success is always "check your email" |
| `/sign-in` | One message for every refusal (wrong password, unknown address, malformed field): it never says whether an address is registered. Success goes to `/session/start?next=…` |
| `/session/start` | A route handler: reads the account once, writes its saved language into the `locale` cookie, clears any role narrowing left from a previous session, and redirects to `next` — which `safeNext` confines to a path on this site (no `//host`, `/\host` or scheme) |
| `/check-email`, `/forgot-password` | "Send me a link", answered the same for every address |
| `/verify-email`, `/reset-password` | The token is taken out of the address bar on load and the page sends `Referrer-Policy: no-referrer`. Verification needs a button press — mail scanners open links, and one that redeemed on load would be spent before its owner saw it. A reset says first that it signs out every session, this one included, then goes to sign-in |
| `/account` | Documents to accept (`GET /legal/outstanding` → `POST /legal/acceptances`), the address and its confirmation, roles, language, time zone, sessions |

**Roles.** Adding the other role is `POST /profiles/roles` with the documents that role requires
(`GET /legal/required?for=INVESTIGATOR|CUSTOMER`), shown and accepted in the same form. This is the
one action outstanding acceptance blocks — the API's role-activation gate — and it is offered only
to a confirmed address. With both roles, "Show the platform as" sets the `active_role` cookie for
the browser session (`chooseActiveRole`); the server forwards it as `X-Active-Role`.

**Time zone.** Stored on the account (`users.timezone`, validated as an IANA name — a fixed offset
is refused because it ignores daylight saving). Every date on these screens is formatted in it. The
form offers the device's own zone when it differs, read after load so the server's HTML and the
browser's agree.

**Sessions.** Listed from `GET /auth/sessions`, this device first, described as "browser on OS"
from the user agent (`describeDevice`) — no IP address or location is shown. Another device's
session ends at once (`DELETE /auth/sessions/:id`); this device's goes through `POST /auth/logout`.

**API added for these screens:** `GET /me` (the account: id, email, confirmation, roles, active
role, locale, time zone), `PATCH /me/preferences` (`locale`, `timezone`; audited as
`account.preferences_updated`), `GET /legal/required`, `locale` and `timezone` on
`POST /auth/register`, and `id` on every legal document response.

**Tested** in Vitest against a stand-in for the API behind `fetch` (`src/test/api.ts`, which
fails any request a spec did not expect), and in a real browser against the real API on every PR —
see [Browser flows](#browser-flows-t-139).

## Missions: open missions for investigators (T-054)

`/missions` shows an investigator — anyone holding the role who has not chosen to see the platform
as a customer — the published missions they could quote on (`POST /search/missions`, described in
`discovery.md`). Everyone else gets two views, as links (T-120): their own missions — a customer's
list and "New mission" (T-119, below), or the empty state without the role — and finding
investigators.

**Built from the registries** (`component-discovery`; searched through the shadcn MCP — `@cult-ui`
answered 429, `@react-bits` has only decorative motion pieces): `card`, `badge`, `drawer`, `command`,
`input-group`, `native-select`, `toggle-group`, `skeleton`, each re-tokenised
(`docs/product/component-inventory.md`). A first version hand-built every piece as native controls in
a `<details>`; it worked and looked like a form, not a product.

- **The address is the browse.** Every filter is a URL parameter (`components/missions/
  browse-query.ts` reads and writes them); the page renders from it, so a filtered list reloads,
  bookmarks and saves as it is. Anything malformed in the URL is dropped before the API sees it.
  Amounts are whole units in the URL and minor units at the API. **The language filter is
  `language`, never `lang`**: the middleware takes `?lang=` as the whole app's language (ADR-0013).
- **Toolbar:** a search field (words order the list, never hide), a Filters button carrying the
  count of what is on, and the order as a native select — shortened labels ("Deadline", "Budget")
  so it fits half a phone's width. With words to look for, the order is theirs and the control
  says so instead.
- **Filter sheet** (`Drawer`): from the bottom on a phone, from the right from `md`. Category is a
  searchable, indented list (`Command`) because a real taxonomy is long and deep; languages, posted
  and distance are chips (`ToggleGroup`); currency and area are native selects. Choices are held in
  the sheet until "Show missions", then pushed as the address; "Reset" clears what narrows and keeps
  the words and the order.
- **Active filters** are chips under the toolbar, each named in words ("AMD 1,500–2,000", "Due by
  Oct 31", "Inside the area") and each a link to the same browse without it.
- **Cards** (`MissionCard` on `Card`): category badge and freshness; title; two lines of
  description; place, distance and languages; then the budget, prominent, and the deadline — a
  deadline within 7 days is a `warning` badge that says "Due in 3 days". Budgets drop ".00" when both
  ends are whole (`formatMoneyRange`), and both ends always share one precision.
- **Loading** is a skeleton of the controls and three cards (`missions/loading.tsx`).
- Refused by the API: 403 says what opens browsing; 422 names the filter to change. Saved searches
  are chips above the list; "Save this search" opens a name field and appears only when something
  is filtered or searched.

**Bundle:** `/missions` is 165 kB (vaul and cmdk), within the 250 kB budget. `Button` takes `Slot`
from `@radix-ui/react-slot` — the `radix-ui` barrel, which the shadcn CLI installs, became a 78 kB
client boundary when a server component rendered Button. Single `@radix-ui/react-*` packages only,
pinned, as admin-web does.

**Tests** stub what jsdom lacks and these components use (`vitest.setup.ts`: `matchMedia`,
`scrollIntoView`, `setPointerCapture`, `ResizeObserver`).

## Missions: a customer's own, and guided intake (T-119)

A customer's `/missions` lists their missions (`GET /missions/me`), newest first, as cards that open
where each stands; a draft a moderator returned says **Changes requested**, not "Draft". "New
mission" opens `/missions/new`.

**Intake** (`components/missions/intake/`) — plain questions, one per screen at every width, in
`steps.ts`: what you need (title, description) → which kind of help (`Command` over the taxonomy)
→ where (country, optional place) → by when (deadline, optional start) → budget (currency, from,
up to) → languages → who it concerns (and, where personal, a protective order) → why (the purpose,
in the customer's words) → the brief. Progress is `Progress` plus "Question 3 of 9" in words.

- **Saves itself** (`use-draft.ts`). Every change is kept at once and sent 800 ms after typing
  pauses; moving between questions, "Finish later", hiding the tab and leaving the intake send
  what is waiting first. Saves are **serial**, each with the version the last returned, so a draft
  never conflicts with itself; a 409 says it changed elsewhere. **Opening `/missions/new` creates
  nothing** — the first saved answer POSTs the draft and the address becomes `/missions/<id>?step=`
  (`history.replaceState`), so a reload opens the same question. A failed save keeps its changes
  for the next one, and the question does not move on until it is saved.
- **Never sends what the database refuses.** An emptied text field is sent as `null` (a CHECK
  refuses empty text). A budget minimum above its maximum, or a start after the finish, is shown
  and kept but not sent until put right, then sent as a pair — both are CHECK constraints the API
  does not map to field errors yet (T-153).
- **Required answers are the API's list** (`REQUIRED_AT_SUBMISSION`, plus the protective-order
  answer for a personal relationship), asked one screen at a time: Continue with one missing flags
  it beside the field and moves focus to it. Optional ones are labelled so.
- **Languages start with the reader's own**, saved and removable — a default, not an assumption.
- **The brief** (`Brief`) is each answer under a plain heading with "Change", then the
  lawful-purpose confirmation — a `Checkbox` only the customer ticks, never pre-ticked or copied —
  and "Send for review". Unanswered questions are marked on the brief; a 422 on sending lists each
  field under the question that fixes it, with a button to it.
- **Returned for changes** — `review.outcome = CHANGES_REQUESTED` on the mission — opens at the
  brief with the moderator's note above every question.
- A sent mission (`/missions/<id>`, not DRAFT) shows where it stands in words — being reviewed,
  published, cancelled — the date sent in the reader's time zone, and the brief read-only. A
  **rejection** shows the moderator's reason (or says none was given) and "Start a new mission from
  this one", which POSTs the answers as a new draft and opens it at the brief; the confirmation is
  never copied.
- Names (categories, countries, languages) are resolved on the server and passed down, so the page
  hydrates as it rendered (`Intl` names differ between Node and browsers).

Built from `@shadcn/progress`, `@shadcn/radio-group` and `@shadcn/checkbox` (re-tokenised, single
`@radix-ui/react-*` packages, pinned) with the existing `command`, `native-select`, `textarea`, `card`
and `alert`. `@react-bits` offers an animated stepper; a progress bar says the same without motion.

## Investigator profile (T-123)

`/account/investigator` is everything that decides whether customers find an investigator and
whether they see open missions, on one page. Someone without the role is sent to `/account#roles`.
Account's roles section links here; the Missions page's "cannot quote yet" state does too. API:
`profiles.md`, `service-areas.md`, `verification.md`, `media.md`.

- **Status first** (`StatusCard`): a checklist — published, verified, accepting, a language, a
  specialty, an area — each item a link to its section, the verification status as a badge, and
  the two switches that are the investigator's (`Switch`, saved on flip). "Preview as a customer"
  opens a `Drawer` with `PublicProfileCard` fed by `GET /profiles/investigator/me/preview`: the API's
  public projection, not the own profile with fields hidden in the browser.
- **One form per section**, each saved alone: about you (`DetailsForm`), languages, specialties
  (the filter sheet's searchable `Command` list), availability (rows of day + from/to), areas,
  verification. Lists are sent whole — the API replaces them.
- **The name** is read-only, with the reason, while verification is `PENDING` or `VERIFIED`, and
  not sent at all then; the API refuses the change anyway (`profiles.md`).
- **Service areas without a map.** No map or place-search provider is chosen, and either sends
  locations to a third party, so an area is "Use my location" + a radius chip (5–100 km) + a name,
  country and city. The position is rounded to two decimals **on the device** before it is sent,
  matching what the database keeps. Denied and failed locations each say what to do. Place
  search and drawing on a map wait for a provider decision (T-147).
- **Verification** uploads each document through the private flow (`POST /media/uploads` → the
  signed form straight to storage → `…/complete`), then applies with the ids. Type, size and count
  are checked before anything is sent; the uploading row shows which file is in flight and is reset
  on failure. History shows outcome, dates and reason — the API never sends the reviewer.
- **Reference lists come from `Intl`**, on the server, passed down as props so hydration agrees:
  currencies (`Intl.supportedValuesOf`), and language and country names (`lib/codes.ts` asks
  `Intl.DisplayNames` for every two-letter code and drops groupings such as EU and UN). No ISO list
  is kept in the codebase.

**Bundle:** 184.9 kB initial JS (vaul, cmdk and the Radix switch), within the 250 kB budget.

**Not verified end to end:** the upload itself, because Cloudinary is not configured locally
(`ACTIONS-FOR-ME.md` #4) — `POST /media/uploads` answers 500 there, which the page reports with its
reference. The rest was driven in the browser at 375px against the real API.

## Workspaces and agency onboarding (T-092)

- **Which workspace a page is in.** The workspace layout reads `GET /workspaces` and renders
  inside `WorkspaceScope`, keyed by the current workspace's id. The scope pins that id for
  `callApi` and the assistant's client, which send it as `X-Workspace` on every browser call
  (`lib/api/workspace.ts`). The module is pinned in the browser only: on the server it would be
  shared across requests, and server renders use the session's default instead
  (`tenancy.md`, resolution).
- **The switcher** (`WorkspaceSwitcher`) appears only with more than one workspace: a
  `DropdownMenu` under the app's name in the sidebar from `md`, and a `Drawer` from a bar above
  the content on a phone. Each row is the workspace's name ("Personal" for a Personal workspace),
  "Being set up" for a `CREATING` agency, and the current one ticked and named "current" for
  screen readers. Choosing one calls `POST /workspaces/:id/activate`, then loads the app again at
  Home; while that runs the trigger says "Switching to …" and is disabled. A refusal is shown
  under the trigger and nothing moves.
- **The confirmation** (`SwitchedNotice`) is the switch's one motion: "Now working in …" fades
  in on the page the switch lands on (`starting:opacity-0`, `--duration-slow`; zero under
  reduced motion). The switch leaves the target's id in `sessionStorage` for the notice to read
  once; storage refused only loses the sentence.
- **Creating an agency** is `/agencies/new`, linked from Account's Agencies section and the
  switcher. One screen: name, country, business email, time zone (the account's own first) and
  currency — all required, although the API accepts fewer, because nothing yet lets an agency's
  details be completed later (T-150) — and the agency terms (`LegalDocuments`). One `Idempotency-Key`
  per form, so a retry after a lost response returns the same agency. Then it activates the new
  agency and loads the app in it. With no agency terms published, the page says agencies cannot
  be created yet instead of offering a form that would be refused; an unconfirmed account is
  asked to confirm its address first.
- **Not built:** the dismissible onboarding checklist. What it would list — the agency's
  profile and settings (T-084), inviting employees (T-085), agency verification (T-088) — does
  not exist yet (filed as T-149).

## An agency's profile and colours (T-094)

`/agency`, reached from Account's Agencies section while working in an agency ("Agency profile and
colours"). Anywhere else there is no agency to show, so it sends the reader to `/account#agencies`.
API: `tenancy.md` §12, `media.md`.

- **Public profile** (`ProfileEditor`): the name customers see (blank → the registered name, said in
  the hint), headline and about, one form saved together; the logo and cover (`ImageField`), each
  saved on choosing; and publishing, a form of its own. Every write names the version read, and the
  answer is the profile as saved — whose version the next write names. A write refused because
  someone saved first shows the API's "changed while you were working — reload".
- **Publishing** lists what it still needs (the API's `missing`: a headline, a finished agency) and
  is held back until nothing is missing. It publishes what is saved, so with changes waiting it is
  held back too, and says so (`aria-describedby`). A published profile links to its public page.
- **The preview** ("Preview as customers see it", a bottom `Drawer`, as T-123's) is
  `AgencyProfileCard` fed by `projection()`: the public projection built from the saved profile and
  the text as typed. It takes `PublicAgencyProfile`, the type `GET /agencies/:id/profile` answers
  with, and `/agencies/[id]` draws the same component from that answer — so the preview is what
  customers get. `GET /agencies/current/profile` returns the agency's `id` and `countryCode` for this
  (T-094); the registered name comes from `GET /workspaces`. The browser suite compares the two
  pages line for line.
- **Images** go through the private flow (`lib/api/media.ts`, `uploadMedia`, shared with
  verification): type and size checked first (JPEG, PNG, WebP; 2 MB logo, 5 MB cover), then
  `POST /media/uploads` → storage → `…/complete` → the profile names it. A file with no link yet is
  waiting for its safety check and says so; the card shows nothing for it, as customers would see.
  **No scanner exists yet (T-065), so an uploaded image stays hidden**, and uploads themselves are
  not verified end to end because Cloudinary is not configured locally or in CI (ACTIONS-FOR-ME #4).
- **Colours** (`BrandingForm`): accent and report header, each `#rrggbb` or blank for the platform's
  own, with the current value in the hint — the defaults are visible, and nothing must be set.
  Contrast is the API's rule; a refused colour is said beside its field. The sample shows the
  **saved** colours with the text colour the API derived, inside `data-theme="light"`: a branded
  fill is measured against the light theme and is never drawn on dark chrome (`design-system`).
- **Only branding has settings.** The other ten sections are empty places (T-084's owner decision),
  so the page shows no section with nothing in it.
- **Permissions are the API's**: a section whose read answers 403 says the reader's role does not
  include it, instead of a form that would be refused. No role name is tested here.

**Browser flow:** `e2e/agency.e2e.ts` — create the agency, reach the page from Account, preview
unsaved text, save, publish, and the public page equal to the preview; a low-contrast colour
refused beside its field, a saved one drawn on a white surface in dark mode (a negative control that
removed the scope failed). axe on each screen.

## Finding investigators (T-120)

A customer's Missions has two views, as links (`MissionsViews`): their own missions (T-119) and
**Find investigators** — not a sixth navigation destination, so the phone bar keeps five (owner
decision, 2026-09-26). Someone working as an investigator is sent back to Missions
(`actsAsInvestigator`, the one reading both pages make).

- **The list** (`InvestigatorDiscovery`) searches from the browser: filters are the address
  (`discovery-query.ts`: `category`, `language`, `country`, `city`, `day`, `pricing`), "Near me"
  is in memory only, so coordinates never enter a URL. Results are `InvestigatorCard`s, "Show
  more" pages on, and an answer to a search a newer one replaced is dropped.
- **Filters** are a sheet (`DiscoverySheet`) on the mission browse's pattern — bottom on a phone,
  right from `md`, held until "Show investigators". Specialty is the searchable tree; languages are
  added one at a time from every language `Intl` names. Each filter that is on is a chip that
  removes itself; "Clear filters" removes them all.
- **Empty is never a dead end.** With filters or a location, "No one matches all of these" and the
  chips to remove; with a location inside a small radius, "Search up to 100 km away". With nothing
  narrowing, "No investigators are listed yet".
- **Why listed** comes only from the API's `matchedOn` and `notMatched` — the card phrases them and
  adds nothing.
- **The profile page** (`/missions/investigators/[id]`) is `PublicProfileCard` (T-123's preview, now
  with a Verified badge and `named={false}` under the page's own heading) and `ProfileReviews`:
  the summary, then each review's stars (read as "4 out of 5"), date, words and reply, never the
  reviewer. No areas: the public projection has none. Not published or not an id → 404.
- **Not built:** the map (T-147's provider); a translated 404 page (T-151).

**Bundle** (the budget script's initial JS): `/missions/investigators` 206.2 kB, the profile page
191.5 kB — within 250 kB.

## The assistant (T-056)

`src/components/assistant/`. Mounted by the workspace layout above every page
(`AssistantProvider`), so a conversation survives moving between pages and closing the panel.

| Width | The assistant |
|---|---|
| below `lg` | A **full-screen sheet** (`Drawer`, `h-dvh`, no handle, `handleOnly`): a dialog that holds focus and returns it on close. Never dragged — scrolling a conversation must not close it. Close and Escape do |
| `lg` and up | **Docked** beside the page, 24rem (`aside`, `complementary`), not modal: the page stays usable. Escape inside it closes it and focus returns to what opened it |

Narrowing the window while it is open moves the same conversation from dock to sheet.

**Loaded on first open.** `AssistantBeside` renders nothing until the assistant is first opened,
then imports the panel (`next/dynamic`) and keeps it mounted — the panel, vaul and the conversation
are not in any page's initial JavaScript (+4 kB per workspace route for the provider and the
navigation button, instead of +30 kB).

**Opening** reads `GET /workspaces` (the header names the workspace — "Personal workspace", or the
agency's name) and `GET /ai/sessions?limit=1`: an `ACTIVE` session (a message in the last 30
minutes) is continued, its messages read page by page; otherwise the conversation starts empty.
**A session is created with the first question**, not on opening, so looking leaves nothing behind.
"New conversation" appears once there is one to leave.

**A turn** is `POST /ai/sessions/:id/turns`, read as server-sent events with `fetch` and a stream
reader (`EventSource` cannot `POST`); `lib/api/assistant.ts` parses the frames however the network
cuts them. The panel shows, in order: the question (from the stream once stored), a polite status —
"Sending your question", "Searching the help articles", "Writing an answer from N sources", with a
pulse only under `motion-safe` — then the answer with its sources, or "not covered" as a state of
its own. Tool calls and results render as structured blocks (tool, then each argument), never as
prose. The conversation is a `role="log"`, so what is added is read out; a failure is an alert.

**Stop and Try again.** While an answer forms, Send becomes Stop, which aborts the request (the API
stops the turn and stores no reply). A turn that ends without an answer leaves a Try again: a
question the server never confirmed is sent again (after reading the conversation back to find out
whether it arrived); a stored one is answered by `…/turns/retry`; a retry the server calls a
conflict (answered in another tab) reads the conversation back instead. A stream cut off without
`done` counts as a failure. What a conversation that was left says afterwards is ignored.

**The composer:** Enter sends, Shift+Enter adds a line, never while an input method composes;
`enterkeyhint="send"`; the keyboard hint shows from `md`; Send is disabled below the API's three
characters and while the conversation is read. **The empty state** teaches the role (investigator
unless acting as a customer — the missions page's reading): what the assistant does today and
cannot yet, and three questions the help articles answer, sent with one tap. **An account with no
role yet** (registration grants none) is answered from the public policies only (T-017, audience by
role), so it is offered three questions those answer, and a link to add a role (`/account#roles`,
closing the assistant on the way). Each suggestion was checked to retrieve its own section first. The role the reader
acts as is sent as `X-Active-Role`, so answers come from that role's guidance.

**Conversations (T-057).** The list button at the top swaps the conversation for **your
conversations** in the same panel — on a phone, the full-screen sheet; never a sidebar squeezed
beside it — and focus goes to its Back button, and on return to the composer. Current or archived
(a toggle), 20 at a time, the open one marked "Open now" and `aria-current`; from two characters,
a search (`GET /ai/sessions/search`, after a 250 ms pause) replaces the list. Choosing one opens
it at its newest 30 messages (`order=newest`), with "Show earlier messages" reaching back a page at
a time while the reader keeps their place; a search result reaches back — at most ten pages — to
the first matching message, scrolls it into view and marks it. The one being opened counts as open
from the moment it is chosen, and whatever an abandoned opening, page or list says afterwards is
ignored.

The options menu (`@shadcn/dropdown-menu`, disabled while an answer forms) renames in place — Enter
saves, Escape cancels the rename and nothing else (caught on the window, ahead of the sheet's own
Escape) — archives (a fresh conversation begins, and says where the old one went), brings back from
the archive, and deletes after `@shadcn/alert-dialog` asks — a bottom sheet on a phone, Cancel
focused first, the text saying that anything the assistant keeps goes too. After a delete, focus
goes to the composer; after a refusal, back to the options. **A conversation that has gone** — a
404 from any of these, which is also what someone else's conversation answers (T-045) — is replaced
by a fresh one saying "That conversation is no longer available", showing nothing of it.

**Structured results (T-059).** A discovery reply renders from its stored answer, never as prose:
what was searched, said out loud (and "every area" when no place was named), the order, then each
investigator as a card (`InvestigatorCard`): name and headline in their own words, Verified,
experience, the reasons from `matchedOn` / `notMatched` — a gap said plainly — and languages,
specialties and declared hours, all phrased here in the reader's language (`discovery-format.ts`:
`Intl.DisplayNames`, `ListFormat`, weekdays from Monday). At most ten; "more match" says how to
narrow. "Nobody matches" and a refusal (with a link to the policy) are states of their own.
Discovery's question — which specialty, where, what for — is answered in place while it is the last
word: a specialty is one tap; "Use my location" sends the device's position rounded to two decimals
(≈1 km); a place or a purpose in words. Sources are links to `/help/[docKey]#section`. A link out of
the assistant closes it when it covers the page (the phone's sheet) and leaves it docked beside the
page on a desktop.

**Help articles** — `/help/[docKey]` reads `GET /knowledge/documents/:docKey` as the reader; not
found is Next's 404. `ArticleBody` renders the knowledge base's markdown subset — paragraphs, flat
lists, tables (scrolling in their own box), quotes, bold, code — and nothing else: every character
is text React escapes.

**Not here yet:** the attachment entry point (T-144 — nothing to attach to); the summary and
structured state a resume should load (T-046 — they do not exist yet); confirmations (T-058);
results paged by reference (T-048); links to missions, quotes, assignments and payments (their
screens, T-119/T-121); AI-drafted text marked unreviewed (drafting, T-117).

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

Recorded at T-091 on the production build, at 375px with Slow 4G and a 4× CPU slowdown (T-128 then
added `use-intl`: 131 kB, still static-sized chunks, but routes now render per request because they
read the reader's language):

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

Every workspace route needs a session, so the API must be running too (port 3001; the `api` entry
in `.claude/launch.json` starts it against the local database with `NODE_ENV=development`, where the
session cookie is sent over plain HTTP and emailed links are written to the API's log).

`pnpm build` at the root builds the tokens first. `next-env.d.ts` is generated and gitignored.

## Browser flows (T-139)

`apps/app-web/e2e/` drives Chromium through the built app and the built API, against a database
migrated from empty — no stand-ins. `account.e2e.ts` is one reader's first hour, in order, on one
account per viewport (375 and 1280px): sign up accepting the published documents (and the consent
rows recorded, read back as the owner), confirm the address from the emailed link, sign in and land
on the page asked for, the session cookie's attributes as the browser holds them (HTTP-only,
`SameSite=Strict`, `Secure`, host-only, unreadable from `document.cookie`), the device's time zone
stored at sign-up and a new one saved, the customer role added with its document, the saved
language restored on a fresh browser, another device's session ended, sign out, and a password
reset. axe (WCAG 2.2 A/AA) runs on every signed-out screen and the account page.

```bash
env -u NODE_ENV pnpm build                                # the suite runs the build, not dev servers
pnpm --filter @investigator/app-web e2e:browser           # once: the Chromium @playwright/test pins
pnpm --filter @investigator/app-web test:e2e
```

What `e2e/global-setup.ts` does, so a failure can be read:

- **Its own database.** `investigator_e2e` is dropped, created, given the extensions and migrated
  on every run (`MIGRATION_DATABASE_URL`, default the local owner), then the documents registration
  and the customer role require are published into it. Publishing is global state — it changes
  what every registration requires — so it never happens in the development database. The API
  connects as the runtime role (`DATABASE_URL` with the database swapped), so row-level security
  applies as in production.
- **Its own servers.** The API on 3001 with `NODE_ENV=test` — a `Secure` cookie, as deployed;
  Chromium accepts one on `http://localhost` — and the app on 3100. The API has to be on 3001
  because Next resolves a rewrite's destination at **build** time: `API_INTERNAL_URL` given to
  `next start` moves server-side reads, not the browser's `/api` calls. Setup refuses to start
  while either port is taken, so stop the development servers first.
- **The inbox is the API's log.** The development mailer writes each link to it
  (`e2e/.output/api.log`), and `support/mailbox.ts` reads a link written after a given point —
  only the token's hash is stored, so there is nowhere else to read it from.

Specs find things by role and by the words in the catalog (`support/text.ts`), never by class or
test id, so the suite reads the screen as a person does and a copy change moves both together. The
journey stays inside the API's per-account sign-in limit (five in five minutes); a new step that
signs in again has to account for it. `agency.e2e.ts` (T-094) is the second journey: its account is
set up through the API, since the account screens are the first journey's subject. Together they
register four accounts a run against the API's five per IP per hour — a third journey that
registers, or a retry of both, meets that limit; the API process is new each run, so a new run
starts from zero. Traces, screenshots and both servers' logs land in
`e2e/.output/` (gitignored), which CI uploads when the step fails.

## Not built here

- A theme toggle — the system setting decides until a user asks otherwise.
- An app icon: the favicon request 404s until there is a brand mark to use.
- Google sign-in (T-062), and changing an email address or password from the account page.
- The workspace switcher and every real screen — T-092 and the core-loop tasks.
- Cancelling a mission from the app (T-154), and attachments on a mission (T-066).
- Finishing an agency's core details after creation (T-150): a profile that lists `agency_setup` as missing
  says so, but there is nowhere to finish it yet.
