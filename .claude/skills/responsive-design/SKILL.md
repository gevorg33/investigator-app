---
name: responsive-design
description: Mobile-first responsive implementation for the web apps — authoring order, breakpoints, touch targets, and the specific patterns for navigation, tables, dialogs, forms and dashboards on small screens. Use when building or reviewing any screen, layout or interactive element.
---

# Responsive design

**Mobile-first, and not as a slogan.** Base styles are the phone layout; larger screens add
complexity through `min-width` queries. Writing desktop styles and overriding them downward
produces a phone experience that is a compromise of a desktop one, which is what this skill
exists to prevent.

Since the mobile companion app is deferred (ADR-0009), **the responsive web app is the only
phone experience this product has.** It is not a fallback.

## The rule that governs the rest

**Adapt the interaction, do not shrink the layout.** A data table is not a small data table on
a phone — it is a list of cards. A modal is not a small modal — it is a sheet. Feature parity is
required; visual parity is not.

## Breakpoints

From tokens (`design-system`), never literals:

| Token | Width | Target |
|---|---|---|
| base | < 640px | Phone — the default, written first |
| `sm` | ≥ 640px | Large phone, small tablet portrait |
| `md` | ≥ 768px | Tablet |
| `lg` | ≥ 1024px | Laptop |
| `xl` | ≥ 1280px | Desktop workspace |

Add a breakpoint when the **content** breaks, not because a device exists. Design to content,
then check the device sizes in `visual-qa`.

## Non-negotiables

1. **The page body never scrolls horizontally.** Wide content — tables, code, diagrams, graphs
   — scrolls inside its own `overflow-x: auto` container. A horizontally scrolling page is a
   bug at any width.
2. **Tap targets ≥ 44×44px**, with spacing between adjacent ones. A 24px icon button with no
   padding is unusable on a phone and fails WCAG target-size guidance.
3. **Every hover affordance has a non-hover equivalent.** Touch devices have no hover. A tooltip
   that only appears on hover, a row action revealed on hover, a dropdown that opens on hover —
   each needs a tap path.
4. **Use `100dvh`, not `100vh`.** Mobile browser chrome makes `100vh` taller than the visible
   viewport, which cuts off the bottom of full-height layouts.
5. **Respect safe areas** — `env(safe-area-inset-*)` for notches and home indicators, on any
   fixed bottom navigation or sticky footer.
6. **Text never below 16px for inputs** — iOS Safari zooms the page on focus below that, which
   is jarring and hard to recover from.

## Patterns

### Navigation

Desktop sidebar → **bottom navigation** on phones for the 3–5 primary destinations, with the
remainder behind a menu. Not everything behind a hamburger: hiding primary navigation on the
smallest screen is backwards.

The staff console (`admin.`) is denser and desktop-weighted, but must still work on a phone — a
moderator reviewing a mission on the move is a real case.

### Tables — the hard one

Three options, chosen by what the table is for:

| Approach | Use when |
|---|---|
| **Card list** | Each row is an entity the user acts on — missions, quotes, evidence, queue items |
| **Priority columns** | The table is genuinely tabular; show 2–3 key columns, expand a row for the rest |
| **Horizontal scroll** | Comparison across many columns is the point. Last resort — sticky first column, and a visible scroll affordance |

Admin queues and evidence lists are **card lists** on phones. Server-side pagination
(`docs/api/pagination.md`) matters more here, not less.

### Dialogs

Centred modal on desktop → **bottom sheet** on phones. Drag-to-dismiss where it fits, always a
visible close control. Full-screen for anything with a form of more than two fields.

Never a modal on a phone that the user must scroll inside *and* scroll the page behind.

### Forms

Single column on phones, always. Multi-column only from `md` up, and only where fields are
genuinely related.

- Correct `inputmode` and `autocomplete` — a numeric field must summon a numeric keypad
- Labels above inputs, never placeholder-as-label
- Errors adjacent to the field, and the summary focusable
- The submit control must not sit under the on-screen keyboard
- Sticky submit bar for long forms, respecting safe area

Mission creation is the longest form in the product — treat it as a multi-step flow on phones,
not one long scroll.

### Dashboards

Stack the cards, and **order by importance rather than by source-order convenience.** What a
customer needs first on a phone — assignment status, unread messages, pending actions — leads.
Charts get a minimum height and their own horizontal scroll, or a simplified variant.

### This product specifically

| Surface | Phone treatment |
|---|---|
| Evidence list | Cards with thumbnail, class badge, capture time |
| Evidence detail | Full-bleed media, pinch-zoom, metadata in a sheet below |
| Report editor | **Read and comment on phone; authoring is desktop.** Say so in the UI rather than shipping an unusable editor |
| Assistant panel | Full-screen sheet, not a docked side panel |
| Mission browse (T-054) | List + filters in a sheet, not an inline sidebar |
| Moderation queue (T-051) | Card list; attachments open full-screen |

## Performance on phones

Real devices on real networks, not a throttled desktop. Budgets are in
`frontend-performance`; the mobile-specific parts:

- Images sized for the viewport, with explicit dimensions to avoid layout shift
- No WebGL on phones (`animation`)
- Virtualise long lists — evidence and queues will get long
- Defer below-the-fold work; the phone is where the bundle hurts most

## Verification

Every screen, in `visual-qa`: 375 / 768 / 1440, plus loading, empty and error states, plus a
reduced-motion pass.

Additionally for touch:

- [ ] No horizontal page scroll at 375px
- [ ] Every interactive target ≥ 44px with spacing
- [ ] Every hover affordance has a tap path
- [ ] Keyboard does not obscure the active input or the submit control
- [ ] Full functionality reachable — nothing desktop-only without a stated reason
- [ ] Safe areas respected on fixed elements
