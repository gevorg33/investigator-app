---
name: frontend-accessibility
description: Accessibility beyond what Radix provides — keyboard paths, focus management, contrast, live regions, and auditing third-party components. Use when adding an interaction, adopting a component from outside shadcn, or building any custom control.
---

# Accessibility

shadcn inherits Radix, which handles a great deal. Three things it cannot handle: components
from other sources, custom controls, and composition.

## Audit what you adopt

**React Bits makes no accessibility guarantee** — quality varies per component. Before
adopting anything outside `@shadcn`:

- [ ] Fully operable by keyboard, in a sensible order
- [ ] Visible focus indicator meeting 3:1 contrast
- [ ] Correct roles and accessible names — not a `div` with a click handler
- [ ] Respects `prefers-reduced-motion`
- [ ] Does not trap focus unintentionally
- [ ] State changes are announced, not only shown

A visually impressive component that fails these does not ship in the application. It may
sometimes be acceptable on marketing as decoration — if it is genuinely decorative and marked
`aria-hidden`.

## Focus

- Modals and sheets trap focus, and **return it to the trigger on close**.
- Route changes move focus to the heading, not to `<body>`.
- Never remove a focus outline without replacing it with something at least as visible.
- Focus order follows visual order. CSS reordering that desynchronises them is a defect.

## Announcing change

Asynchronous results need a live region: an evidence item arriving, a verification completing,
an AI response finishing, a validation failing.

Use `aria-live="polite"` for most things and `assertive` only for errors that block progress.
A silent update is invisible to a screen-reader user.

## Forms

Every input has a programmatic label. Errors are associated with their field, not only shown
in colour. The error summary is focusable and links to fields.

Validation messages come from translation keys (`localization`) — never English literals.

## Colour and meaning

WCAG AA: 4.5:1 body, 3:1 large text and UI boundaries, in **both** themes.

**Never encode meaning in colour alone.** Evidence states, verification status and
contradiction warnings each need a label or icon. This matters more here than in most products
— misreading an evidence state is a correctness failure, not a cosmetic one.

## The graph (when it exists)

Node graphs are the hardest thing here to make accessible, and this is worth planning before
building rather than retrofitting: keyboard traversal between nodes, an accessible name per
node and edge, and — most importantly — **a non-graph equivalent view** of the same
relationships. A list or table conveying the same information is usually the honest answer.

## Checklist

- [ ] Keyboard-operable end to end
- [ ] Focus visible, trapped and returned correctly
- [ ] Roles and names correct; not a clickable `div`
- [ ] Async changes announced
- [ ] Contrast AA in both themes
- [ ] No meaning carried by colour alone
- [ ] Reduced motion honoured
- [ ] Third-party component audited before adoption
