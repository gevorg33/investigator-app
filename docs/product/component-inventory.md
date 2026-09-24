# Component inventory

Every reusable UI component, so the next agent does not rebuild what exists. Updated in the
**same task** that adds a component — see `component-discovery`.

| Component | Source | Used in | Notes |
|---|---|---|---|
| `Empty` (+ `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`) | `@shadcn/empty` | `EmptyState` | app-web `src/components/ui/empty.tsx`. Re-tokenised: `cn` from our helper; title is an `h2` and description a `p` (upstream renders both as `div`) |
| `EmptyState` | custom — composition of `@shadcn/empty` | Every placeholder route | The one shape an empty screen takes: icon, what will appear, why. A composition, not a second empty component |
| `AppShell` | custom | `(workspace)/layout.tsx` | Frame: skip link, sidebar from `md`, bottom bar on phones, `main`. **Why custom:** `@shadcn/sidebar` becomes a hamburger sheet on phones — the pattern `responsive-design` forbids for primary navigation — and brings seven more components; no registry has a bottom navigation |
| `NavLinks` | custom | `AppShell` | The destinations as a bottom bar or a rail. **Why custom:** searched `@shadcn` (sidebar, navigation-menu), `@cult-ui` (dock, direction-aware-tabs, side-panel) and `@react-bits` (Dock). The docks are hover-driven magnifiers with no touch path; tabs switch panels, not routes |
| `Page` | custom | Every route | Title plus body at a readable measure. Layout only, too small to take from a registry |

## Columns

- **Source** — `@shadcn`, `@cult-ui`, `@react-bits`, or `custom`
- **Notes** — for `custom`, why nothing existing fit. This is the field that stops the same
  custom component being written twice

## Before adding a row

The component was searched for first, its source was read if outside `@shadcn`, and it was
re-tokenised. If any of those did not happen, it is not ready for the inventory.
