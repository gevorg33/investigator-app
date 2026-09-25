# Component inventory

Every reusable UI component, so the next agent does not rebuild what exists. Updated in the
**same task** that adds a component — see `component-discovery`.

| Component | Source | Used in | Notes |
|---|---|---|---|
| `Empty` (+ `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`) | `@shadcn/empty` | `EmptyState` | app-web `src/components/ui/empty.tsx`. Re-tokenised: `cn` from our helper; title is an `h2` and description a `p` (upstream renders both as `div`) |
| `EmptyState` | custom — composition of `@shadcn/empty` | Every placeholder route | The one shape an empty screen takes: icon, what will appear, why. A composition, not a second empty component |
| `AppShell` | custom | `(workspace)/layout.tsx` | Frame: skip link, sidebar from `md`, bottom bar on phones, `main`. **Why custom:** `@shadcn/sidebar` becomes a hamburger sheet on phones — the pattern `responsive-design` forbids for primary navigation — and brings seven more components; no registry has a bottom navigation |
| `NavLinks` | custom | `AppShell` | The destinations as a bottom bar or a rail. **Why custom:** searched `@shadcn` (sidebar, navigation-menu), `@cult-ui` (dock, direction-aware-tabs, side-panel) and `@react-bits` (Dock). The docks are hover-driven magnifiers with no touch path; tabs switch panels, not routes |
| `Button` (+ `buttonVariants`) | `@shadcn/button` | admin-web landing page | admin-web `src/components/ui/button.tsx`. Re-tokenised: `cn` from our helper; `Slot` from `@radix-ui/react-slot`, not the `radix-ui` umbrella; focus is the app outline (upstream `outline-none` + `ring-[3px]` removed); no `dark:` overrides; sizes ≥ 44px only (`default`, `lg`, `icon`) |
| `Button` (+ `buttonVariants`) — app-web | `@shadcn/button` | Every auth and account form, mission browse | app-web `src/components/ui/button.tsx` (T-127). Same changes as admin-web's; `Slot` from `@radix-ui/react-slot` (T-054: the `radix-ui` barrel became a 78 kB client boundary when a server component rendered Button); sizes `default` (44px) and `icon` only; variants `default`, `destructive`, `outline`, `ghost`, `link` |
| `Input` | `@shadcn/input` | `Field` | app-web `src/components/ui/input.tsx` (T-127). 44px tall; 16px text at every width (upstream `md:text-sm` removed — below 16px iOS zooms on focus); boundary `border-control` (3:1); no ring |
| `Alert` (+ `AlertContent`, `AlertTitle`) | `@shadcn/alert` | `FormError`, sign-in and verify notices | app-web `src/components/ui/alert.tsx` (T-127). Flex instead of upstream's arbitrary grid columns; `AlertContent` added so title and text share a column beside the icon; `role="alert"` only for `destructive`, `status` otherwise; `AlertDescription` dropped (unused) |
| `Field` | custom — composition of `Input` | Every form | Label above the input (never a placeholder label), hint and error wired through `aria-describedby`, `aria-invalid` from the error. Too small and too tied to our error plumbing to take from a registry; shadcn's `form` needs react-hook-form, which these forms do not |
| `FormError` | custom — composition of `Alert` | Every form | A form's API error in the reader's language, by `messageKey`, with a per-form override per code (sign-in's one message for every refusal); the reference id only for failures support can help with |
| `useSubmit` | custom hook | Every form | One submit at a time, the error kept, a dropped connection reported as an error. No registry equivalent |
| `LegalDocuments` | custom — native `<details>` | Sign-up, add a role, documents to accept | Each required document readable in full in place, one required checkbox, the ids posted back. **Why custom:** `@shadcn/accordion` and `@shadcn/checkbox` bring Radix state for what `<details>` and a native checkbox do without JavaScript — and the checkbox must take part in native form validation |
| `Card` (+ `CardHeader`, `CardTitle`, `CardContent`, `CardFooter`) | `@shadcn/card` | `MissionCard` | app-web `src/components/ui/card.tsx` (T-054). Re-tokenised: raised surface, `shadow-raised`, `rounded-lg`, phone-first inset; `CardTitle` is an `h3`; `CardAction`/`CardDescription` dropped until used |
| `Badge` | `@shadcn/badge` | Card category, urgent deadline, filter count | app-web `src/components/ui/badge.tsx` (T-054). Variants `default`, `secondary` (primary tint), `outline`, and `warning` added for a close deadline; no `asChild`/Slot, no focus ring — a badge is never interactive |
| `Drawer` | `@shadcn/drawer` (vaul 1.1.2) | Mission filter sheet | app-web `src/components/ui/drawer.tsx` (T-054). The responsive sheet: bottom on phones, right from `md` (the caller picks the direction). `bg-scrim/50` backdrop (new `scrim` token), `max-h-sheet` utility, `z-(--z-modal)`, safe-area padding; top/left directions dropped |
| `Command` (+ `CommandInput`, `CommandList`, `CommandEmpty`, `CommandItem`) | `@shadcn/command` (cmdk 1.1.1) | Category picker in the filter sheet | app-web `src/components/ui/command.tsx` (T-054). Used inline, not as a dialog: `CommandDialog`, `CommandShortcut` and the `dialog` component the CLI added were removed. Rows 44px, 16px search text. **Name it with the root's `label` prop** — cmdk labels its input from that, and ignores an `aria-label` on the input |
| `InputGroup` (+ `InputGroupAddon`, `InputGroupInput`) | `@shadcn/input-group` | Mission search | app-web `src/components/ui/input-group.tsx` (T-054). 44px, `border-control`, the focus outline around the whole group; textarea, buttons and trailing addons dropped (and the `textarea` component the CLI added) |
| `NativeSelect` | `@shadcn/native-select` | Sort, currency and service-area pickers | app-web `src/components/ui/native-select.tsx` (T-054). 44px, 16px text, `border-control`; the platform's own picker on a phone |
| `ToggleGroup`, `ToggleGroupItem` (+ `toggleVariants`) | `@shadcn/toggle-group`, `@shadcn/toggle` | Filter chips (languages, posted, distance) | app-web `src/components/ui/toggle-group.tsx`, `toggle.tsx` (T-054). Chips that wrap, not a joined bar that overflows a phone; 44px; "on" is tint + border + weight. Single-choice groups use a non-empty value for "any" — Radix reads `''` as nothing chosen |
| `Skeleton` | `@shadcn/skeleton` | `missions/loading.tsx` | app-web `src/components/ui/skeleton.tsx` (T-054). Sunken surface, `aria-hidden`, no pulse under reduced motion |
| `MissionCard` | custom — composition of `Card` + `Badge` | Missions (investigator browse) | One published mission as an `article` named by its title: category badge and freshness; title; two-line description; place, distance and languages; budget and deadline in the footer, a deadline within 7 days flagged by a `warning` badge in words |
| `BrowseToolbar`, `FilterSheet` | custom — compositions of `InputGroup`, `NativeSelect`, `Drawer`, `Command`, `ToggleGroup`, `Field` | Missions | Search, the filters button with its count, the order; the sheet holds choices until "Show missions", then writes the address — the URL stays the one description of a browse |
| `ActiveFilters` | custom — links styled as removable chips | Missions | Each filter that is on, in words, removing itself in one tap (a link to the same browse without it), and "clear filters". Links, not badges: each is a 44px target |
| `SavedSearchList`, `SaveSearch` | custom | Missions | Saved searches as chips with a delete button; "Save this search" as a quiet button that opens a name field. Compositions of `Button`, `Input`, `FormError` |
| `BrowseRefusal` | custom — composition of `FormError` | Missions | An API refusal of a browse, with one line per refused filter |
| `AuthCard` | custom | Every `(auth)` page | Title plus content, spaced for a phone. Layout only |
| `AccountSection` | custom | Account page | A titled card that is a named region, reachable by id (`/account#legal`). Layout only |
| `Page` | custom | Every route | Title plus body at a readable measure. Layout only, too small to take from a registry |

## Columns

- **Source** — `@shadcn`, `@cult-ui`, `@react-bits`, or `custom`
- **Notes** — for `custom`, why nothing existing fit. This is the field that stops the same
  custom component being written twice

## Before adding a row

The component was searched for first, its source was read if outside `@shadcn`, and it was
re-tokenised. If any of those did not happen, it is not ready for the inventory.
