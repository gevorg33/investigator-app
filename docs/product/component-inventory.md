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
| `Button` (+ `buttonVariants`) — app-web | `@shadcn/button` | Every auth and account form | app-web `src/components/ui/button.tsx` (T-127). Same changes as admin-web's; `Slot` from the pinned `radix-ui` umbrella the CLI installs; sizes `default` (44px) and `icon` only; variants `default`, `destructive`, `outline`, `ghost`, `link` |
| `Input` | `@shadcn/input` | `Field` | app-web `src/components/ui/input.tsx` (T-127). 44px tall; 16px text at every width (upstream `md:text-sm` removed — below 16px iOS zooms on focus); boundary `border-control` (3:1); no ring |
| `Alert` (+ `AlertContent`, `AlertTitle`) | `@shadcn/alert` | `FormError`, sign-in and verify notices | app-web `src/components/ui/alert.tsx` (T-127). Flex instead of upstream's arbitrary grid columns; `AlertContent` added so title and text share a column beside the icon; `role="alert"` only for `destructive`, `status` otherwise; `AlertDescription` dropped (unused) |
| `Field` | custom — composition of `Input` | Every form | Label above the input (never a placeholder label), hint and error wired through `aria-describedby`, `aria-invalid` from the error. Too small and too tied to our error plumbing to take from a registry; shadcn's `form` needs react-hook-form, which these forms do not |
| `FormError` | custom — composition of `Alert` | Every form | A form's API error in the reader's language, by `messageKey`, with a per-form override per code (sign-in's one message for every refusal); the reference id only for failures support can help with |
| `useSubmit` | custom hook | Every form | One submit at a time, the error kept, a dropped connection reported as an error. No registry equivalent |
| `LegalDocuments` | custom — native `<details>` | Sign-up, add a role, documents to accept | Each required document readable in full in place, one required checkbox, the ids posted back. **Why custom:** `@shadcn/accordion` and `@shadcn/checkbox` bring Radix state for what `<details>` and a native checkbox do without JavaScript — and the checkbox must take part in native form validation |
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
