---
name: frontend-performance
description: Bundle budgets, Core Web Vitals, lazy-loading heavy visuals, and measuring before and after. Use when adding a dependency, a visual effect, or a route, and before shipping any marketing page.
---

# Frontend performance

Two surfaces, two reasons to care. Marketing: Core Web Vitals are an SEO ranking input
(`domain-and-seo`). Application: investigators work in it all day, and slow tools get resented.

## Budgets

| | Marketing | Application |
|---|---|---|
| Initial JS (gzipped) | ≤ 150KB | ≤ 250KB |
| LCP | ≤ 2.0s | ≤ 2.5s |
| CLS | ≤ 0.1 | ≤ 0.1 |
| INP | ≤ 200ms | ≤ 200ms |

Budgets are checked in CI, not hoped for. Exceeding one is a conversation, not an automatic
block — but it must be deliberate and recorded.

## Measure, do not guess

Record before and after for any change adding a dependency or a visual effect. "It feels fine"
on a developer machine on a fast connection is not evidence. Test throttled.

## Heavy visuals

Shader Gradient pulls three.js and `@react-three/fiber` — by far the largest payload in the
stack, on the page whose Core Web Vitals matter most. Therefore:

- Dynamic import, never in the initial bundle
- Behind an intersection observer
- Static poster image first, so LCP is the poster and not the canvas
- **Off** under `prefers-reduced-motion`
- **Never on mobile** — the battery and thermal cost is real
- If it does not survive measurement, it does not ship

## Common wins

- Ship one font family, subset, `font-display: swap`, self-hosted and preloaded
- Images sized and modern-format, with explicit dimensions to avoid CLS
- Server components by default; `"use client"` only where interaction requires it
- Dynamic-import anything below the fold and any modal body
- Virtualise long lists — evidence lists and admin queues will get long

## Data-shaped costs

The admin queues and evidence lists paginate **server-side** (`docs/api/pagination.md`). A
client-side table that fetches every row is a performance problem and a bulk-extraction
problem at once.

## Avoid

Continuous JS animation loops · large WebGL scenes outside the marketing hero · expensive
blur and filter effects on scroll · layout-triggering animated properties · a second animation
library · barrel imports pulling a whole package for one symbol.

## Checklist

- [ ] Measured before and after, throttled
- [ ] Within budget, or the excess is deliberate and recorded
- [ ] Heavy visuals dynamically imported with a poster
- [ ] No layout-triggering animated properties
- [ ] Long lists virtualised, pagination server-side
- [ ] New dependency justified against its bundle cost
