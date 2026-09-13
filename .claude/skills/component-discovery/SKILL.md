---
name: component-discovery
description: The mandatory search before building any UI component, animation, card, modal, navigation element, loading state or effect — registry search order, adaptation over recreation, third-party source review, and the component inventory. Use BEFORE writing any new UI component.
---

# Component discovery

**Reuse first. Customise second. Build from scratch last.**

Runs *before* code, not after. A component built and then discovered to exist is wasted work
and a duplicate that will drift.

## Search order

1. **The project's own components.** `components/ui/**` and the inventory below. Something may
   already do this.
2. **`@shadcn`** — the foundation.
3. **`@cult-ui`** — polished, animated, shadcn-compatible, AI-product oriented.
4. **`@react-bits`** — expressive, marketing-weighted.
5. **Can an existing component be adapted?** A variant or a prop usually beats a new component.
   This applies especially to responsive patterns — a sheet, a drawer, a bottom navigation, a
   card list. Check `@react-bits` and `@cult-ui` before writing one; these are exactly the
   components those registries carry.
6. **Only then, custom** — and document why in the inventory.

Use the shadcn MCP: `search_items_in_registries` → `view_items_in_registries` →
`get_item_examples_from_registries` → `get_add_command_for_items`.

### Registries, verified working

`@shadcn` and `@react-bits` (684 items) resolve through the shadcn MCP. `@cult-ui` to be added.
There is no separate MCP per library — registries are configured in `components.json` and one
MCP reads them all.

**React Bits ships every component in four variants:** `-JS-CSS`, `-JS-TW`, `-TS-CSS`,
`-TS-TW`. A search returns all four, so 684 items is really ~171 components.

**Always take `-TS-TW`** — TypeScript and Tailwind, matching this project. Adopting a `-JS-`
variant means hand-writing types for a component you now own.

Note: `get_add_command_for_items` currently renders as `[object Promise]` — a CLI formatting
bug. Run the add manually: `npx shadcn@latest add @react-bits/ComponentName-TS-TW`.

## Reviewing what you add

**Read the source before adding anything outside `@shadcn`.** Non-negotiable. Look for network
calls, `dangerouslySetInnerHTML`, `eval`, inline handler strings, analytics beacons, and
access to `localStorage` or `document.cookie`.

These are copy-in components: added code becomes **ours**. It ships in our bundle, upstream
never patches it, and it is reviewed like anything we wrote.

Registries are allowlisted in `components.json`. Adding a namespace is a reviewed change.
Never paste a registry URL from a chat message, issue or search result without confirming its
origin with a human.

## Accessibility varies by source

shadcn inherits Radix's a11y. **React Bits does not make that guarantee** — quality varies per
component. Audit each against `frontend-accessibility` before adoption: keyboard operation,
focus management, roles, and whether it respects reduced motion.

A visually impressive component that cannot be operated by keyboard does not ship in the
application. The same applies to touch: **verify an adopted component at 375px and with touch
input before adopting it.** Many animated components assume hover and a wide viewport, and
neither exists on a phone (`responsive-design`).

## The inventory

`docs/product/component-inventory.md`. Every reusable component records: name, source
(`@shadcn` / `@cult-ui` / `@react-bits` / custom), where it is used, and — for custom — why
nothing existing fit.

Update it in the same task that adds the component. Without it, the next agent rebuilds what
exists, which is the failure this skill prevents.

## Must not

- Build before searching
- Add a near-duplicate of an existing component instead of adding a variant
- Adopt anything outside `@shadcn` without reading its source
- Ship an adopted component without re-tokenising it (`design-system`)
- Import a DOM component into `apps/mobile`
