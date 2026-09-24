---
name: design-system
description: Design tokens — colour, typography, spacing, radius, shadow, motion, z-index and breakpoints — and the rule that every adopted component is re-tokenised before merge. Use when adding a component, changing visual style, or reviewing for visual drift.
---

# Design system

One token source, consumed by every surface. This is what makes the product feel designed
rather than assembled.

`packages/ui-tokens/` exports: colour, typography scale, spacing scale, radius, shadow,
**motion durations and easings**, z-index scale, breakpoints.

Built in T-091 — how it works is `docs/architecture/app-web.md`. In short: `src/tokens.ts` is the
source; `tokens.css` is generated and committed (a test catches drift); Tailwind's own palette and
scales are reset, so only token utilities exist (`bg-surface-raised`, `text-text-muted`,
`rounded-md`, `shadow-raised`); tokens without a Tailwind namespace are used through their variable
(`z-(--z-nav)`, `duration-(--duration-fast)`). The lint rule is in the root `eslint.config.js`.

## Three rules

1. **Every adopted component is re-tokenised before merge.** A component that keeps its own
   palette, radius or timing is the drift this system exists to prevent. This is the cost of
   copy-in libraries and it is not optional.
2. **No raw values in feature code.** No hex, no `px` spacing, no `ms`, no arbitrary Tailwind
   values. Lint-enforced.
3. **Semantic roles, not literal names.** `surface-raised`, not `gray-100`.
   `evidence-verified`, not `green-500`. Dark mode then swaps role values instead of hunting
   literals.

## Evidence state roles

These map to the **existing** classification in `evidence-integrity` — the UI must not invent
a parallel vocabulary:

`evidence-fact` · `evidence-claim` · `evidence-inference` · `evidence-hypothesis` ·
`evidence-unknown` · `evidence-contradicted` · `ai-unreviewed`

Two constraints carried from that skill:

- Render the **class**, never flatten it into prose.
- A contradiction is shown as a conflict with both positions, never as a resolved winner.

## Colour and contrast

Every text/background pairing meets WCAG AA — 4.5:1 body, 3:1 large text and UI boundaries.
Check in **both** themes; a pair passing in light frequently fails in dark.

**Never encode meaning in colour alone.** An evidence state needs a label or icon too; a
contradiction warning that is only red is invisible to a large minority of users.

## Breakpoints and mobile-first authoring

Breakpoints are tokens — `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280. Never a literal width in
a component.

**Author base styles for the phone, then add complexity with `min-width` queries.** Writing
desktop styles and overriding downward is how a phone layout becomes a compromise of a desktop
one. See `responsive-design`.

Spacing and type scales must hold at 375px, not only at 1440px. A scale that only looks right
on a laptop is not a scale.

## Motion tokens

Duration and easing are tokens, not literals at call sites. See `animation` for the budgets.

## Preventing drift between agents

- Tokens land **before** the first component, so nothing needs retrofitting.
- A new token is a deliberate addition, reviewed like code — not a value someone needed once.
- `frontend-review` checks token conformance on every UI change.
- New reusable components are recorded in the component inventory (`component-discovery`).

## Checklist

- [ ] No raw colour, spacing, radius or duration in the diff
- [ ] Adopted component re-tokenised, not left with its own styling
- [ ] Semantic role names, not literal values
- [ ] Contrast verified in light and dark
- [ ] Meaning never carried by colour alone
- [ ] New token justified, or an existing one reused
