---
name: ui-architecture
description: The UI stack hierarchy and where each library may be used — which surfaces exist, which libraries are adopted or rejected, and the escalation path from component to custom code. Use before any UI work, when choosing a library, or when tempted to add a dependency.
---

# UI architecture

Decisions in `docs/architecture/ADR-0003-ui-stack.md` and `ADR-0004`. This is how to work
within them.

## Surfaces

| Surface | Origin | Character |
|---|---|---|
| Marketing | apex | Expressive. May use the full stack |
| Application | `app.` | Functional. `clarity > performance > usability > effect` |
| Staff console | `admin.` | Functional, denser. Separate app, separate origin |
| Mobile companion | Expo | **No DOM libraries.** Shares tokens only |

## Hierarchy — try in order

```
shadcn/ui        foundation, tokens, Radix a11y primitives
   ↓
Cult UI          polished shadcn-compatible components
   ↓
React Bits       expressive pieces, marketing-weighted
   ↓
Motion           only when no component fits
   ↓
Custom           last resort — and it must be documented
```

Anime.js only for sequenced SVG where Motion genuinely cannot. It is not a second
general-purpose animation library.

## Not dependencies

- **React Flow** — adopted *for the future intelligence layer*, **not a v1 dependency**
  (ADR-0005). Do not install it.
- **Haikei** — a browser tool. Export SVG, commit as an asset, re-tokenise the colours.
- **Shader Gradient** — marketing hero only, lazy, poster fallback, never mobile.
- **Refero** — research resource, not a library.
- **Webild, Nexflow, FintechX, Verseo, Galilee, DreamMotion** — Webflow/Framer templates.
  **Not React. Cannot be installed.** Inspiration only.
- **Remotion** — build-time video tool. Paid company licence at 4+ employees.

## Adding a dependency

Adding a UI or animation library is an **ADR**, not a judgement call. State what it does that
the existing stack cannot, its licence, its bundle cost, and its accessibility posture.

The goal is a coherent product, not maximum capability.

## Must not

- Install React Flow, or design UI against entities and relationships (ADR-0005)
- Import a DOM component library into `apps/mobile`
- Put authenticated UI on the marketing domain
- Share components between the customer app and the staff console that carry staff assumptions
