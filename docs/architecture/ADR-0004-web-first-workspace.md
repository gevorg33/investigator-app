---
adr: 0004
title: Web-first product workspace; mobile as a companion
status: Accepted
date: 2026-09-12
supersedes: —
superseded_by: —
related:
  - plan.md §3
  - docs/architecture/ADR-0002-domain-architecture.md
  - docs/architecture/ADR-0003-ui-stack.md
---

# ADR-0004 — Web-first workspace, mobile companion

**Status:** Accepted · **Date:** 2026-09-12

## Context

`plan.md` §3 originally made React Native / Expo the primary surface, stating "the mobile app
contains both customer and investigator experiences."

That does not survive contact with the work. The investigator workspace involves evidence
review, report authoring, large result sets, timeline navigation and — eventually — graph
visualisation. These are desk-bound, multi-pane, keyboard-driven interactions.

It also does not survive contact with the component ecosystem: shadcn/ui, Cult UI, React Bits
and React Flow are DOM libraries. **None run in React Native.** Keeping mobile primary would
mean either a second, unrelated component ecosystem for the main product, or forcing
desktop-class interactions onto a phone.

## Decision

```
Next.js Web            →  Primary product workspace
Expo / React Native    →  Secondary mobile companion
```

**Web (`app.mydomain.com`)** — customer workspace, investigator workspace, investigation
dashboard, evidence management, AI assistant, reports, advanced visualisation. Responsive, so
a phone browser remains usable for anything not in the companion app.

**Staff (`admin.mydomain.com`)** — a **separate application on a separate origin**, per
`plan.md` §1. Not a route group inside the main app. See "Why admin is its own origin" below.

**Mobile companion** — the workflows a phone is genuinely better at: evidence capture
(camera, files), notifications, messaging, quick status updates, location-aware actions, and
lightweight customer and investigator actions.

The mobile app is not a reduced clone of the web app. It is the set of tasks that benefit
from being in a pocket. Anything else lives on the web and is reachable through the phone's
browser.

## Reasons

1. **The interactions are desktop-shaped.** Side-by-side evidence comparison, a report editor,
   a timeline scrubber and a node graph are not phone interactions. Building them twice, once
   badly, serves nobody.
2. **One component ecosystem for the main product.** ADR-0003's stack applies wholesale to the
   web surface. A React Native primary surface would need a parallel design system, doubling
   the drift risk the token system exists to prevent.
3. **Capture genuinely belongs on mobile.** An investigator photographing evidence in the
   field is the strongest mobile use case in the product, and it is a small, well-bounded
   app — not a port of everything.
4. **Responsive web covers the gap.** A customer checking a quote on their phone uses the web
   app. The companion app is for what the browser does badly.

## Why admin is its own origin

`plan.md` §1 specifies a separate staff application. That is the right call, and the reason is
cookie isolation.

ADR-0002 established host-only session cookies. A separate origin therefore means a **staff
session cookie is physically unreachable from the customer application**. An XSS in the
customer app — the surface with the most user-generated content, rendered for the most users —
cannot steal a session that can access evidence across every assignment, suspend accounts, or
touch payouts.

Route-grouping admin inside `app.` would collapse that isolation for a small gain in
convenience. Additional consequences of the split, all of them wanted:

- `admin.` can be IP-restricted or VPN-gated at the edge, which the customer app never could
- Admin code is not shipped in the customer bundle
- The two deploy independently
- Staff-assumption components cannot leak into the customer app, which the `admin-web` agent
  already forbids

## Consequences

**Accepted:**
- `plan.md` §3, §26 and §28 are amended; mobile moves out of the first milestone
- Two clients to maintain, though the mobile one is far smaller than originally scoped
- Push notifications and camera capture remain mobile-only capabilities

**Gained:**
- One design system and one component ecosystem for the product's core
- ADR-0003's stack applies without exception on the primary surface
- Mobile scope shrinks to something deliverable
- The first milestone loses its largest unvalidated surface

## What shares, what differs

**Shared:** design tokens (colour, type, spacing, motion), the API, Zod schemas in
`packages/validation`, i18n catalogs, auth model.

**Not shared:** components. shadcn/Cult UI/React Bits are web-only; the companion app uses
React Native primitives styled from the same tokens. `packages/ui` must therefore stay
web-only, or split explicitly — a shared component package importing DOM libraries would
break the mobile build.

## Revisit when

- A genuine field-work requirement appears that the browser cannot serve and that is large
  enough to justify porting a workspace surface
- Mobile usage data shows customers doing substantial work in the companion app that the web
  surface should be handling
