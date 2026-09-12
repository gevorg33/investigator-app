---
adr: 0003
title: UI and animation stack — what we adopt, what we reject
status: Accepted
date: 2026-09-12
supersedes: —
superseded_by: —
related:
  - docs/architecture/ui-architecture-plan.md
  - docs/architecture/ADR-0002-domain-architecture.md
  - .claude/skills/component-discovery/SKILL.md
---

# ADR-0003 — UI and animation stack

**Status: Accepted** — both gating decisions resolved by ADR-0004 and ADR-0005.

## Context

The platform needs a coherent, premium, AI-native interface across two very different
surfaces: an expressive marketing site and a functional investigator/customer application
(ADR-0002 puts them on separate origins). Fifteen candidate libraries were proposed.

The risk being managed is not "too few effects". It is **visual incoherence and performance
debt** from assembling unrelated libraries, and — for this product specifically — an
application that feels like a showcase rather than a tool people trust with evidence.

## Decision

### Adopted

| Layer | Choice | License | Where |
|---|---|---|---|
| Foundation | **shadcn/ui** | MIT, copy-in | Both surfaces |
| Animated components | **Cult UI** | Open source, shadcn-compatible, AI-product oriented | Both, app sparingly |
| Expressive components | **React Bits** | **MIT + Commons Clause** | Marketing primarily |
| Animation primitive | **Motion** (`motion`, ex-Framer Motion) | MIT | Both — already Cult UI's dependency |
| Graph *(not v1 — ADR-0005)* | **React Flow / XYFlow** | **MIT core**; Pro is optional examples only | Deferred with the intelligence layer |
| Background assets | **Haikei** | Tool, exports SVG. Paid tier for commercial | Marketing, as static assets |

### Adopted conditionally

| Choice | Condition |
|---|---|
| **Shader Gradient** | Marketing hero only. Lazy-loaded, `prefers-reduced-motion` off-switch, static poster fallback, never on mobile. It pulls three.js + r3f — a large WebGL payload on the page whose Core Web Vitals matter most |
| **Anime.js** | MIT. Only where Motion genuinely cannot express the behaviour — timeline-sequenced SVG. Not a second general-purpose animation library |
| **Remotion** | **Paid Company License at 4+ employees.** Adopt only when a video deliverable is actually scheduled, as a build-time tool, never a runtime dependency |

### Rejected as dependencies

| Candidate | What it actually is | Disposition |
|---|---|---|
| **Webild, Nexflow, FintechX, Verseo, Galilee, DreamMotion** | **Webflow / Framer marketing templates** — not React libraries. They cannot be installed in a Next.js app | Visual inspiration only |
| **Manus** | An autonomous AI agent platform. Not a UI library | Not applicable |
| **cloud.craft** | Could not be identified with confidence | Unresolved — the requester should confirm what was meant |
| **Refero** | A design-reference gallery, not a library. **Offers an MCP** | Research resource / candidate MCP |

## Hierarchy

```
shadcn/ui              foundation, tokens, a11y primitives
   ↓
Cult UI                polished shadcn-compatible components
   ↓
React Bits             expressive pieces, marketing-weighted
   ↓
Motion                 when no component fits
   ↓  (Anime.js only for sequenced SVG)
Custom                 last resort, and it must be documented
```

Specialised: React Flow → graph · Haikei + Shader Gradient → marketing visuals ·
Remotion → generated video · Refero → research.

## Reasons

1. **One foundation, one token system.** shadcn is copy-in source we own, so every adopted
   component is adapted to our tokens rather than importing its own visual language. Cult UI
   and React Bits are both shadcn-compatible copy-in, so the same applies — this is what
   makes "one product, not a library collection" achievable rather than aspirational.
2. **Motion is already in the tree** as Cult UI's dependency. Adding a second general-purpose
   animation library would be a second way to express the same thing.
3. **React Flow's core is MIT** with no commercial restriction; Pro buys examples, not
   capability.
4. **The two surfaces have opposite priorities.** Marketing optimises for impression;
   the application optimises for `clarity > performance > usability > effect`. They share
   tokens, they do not share expressiveness. This is stated so drift is visible.

## Licensing to raise with counsel

- **React Bits is MIT + Commons Clause**, not OSI-approved MIT. The clause restricts selling
  the components as a competing product — almost certainly fine here, but it is a
  non-standard licence in a commercial platform and belongs in the dependency review.
- **Remotion** requires a paid Company License at 4+ employees.
- **Haikei** free tier covers generation; commercial use terms should be confirmed before
  assets ship on the marketing site.
- shadcn, Cult UI, Motion, Anime.js, React Flow core: permissive, no action.

## Consequences

**Accepted:** three component sources to keep coherent · Shader Gradient's payload confined
to one lazy-loaded route · adopted components must be token-adapted, which costs time per
component.

**Gained:** one visual language · no runtime component dependency to version-chase · graph
capability without licence cost · an explicit rejection list, so a future agent does not
re-litigate Webflow templates as npm packages.

## Gating decisions — resolved

1. **Workspace surface** — resolved by **ADR-0004**: web-first. This stack applies in full to
   the web surface. The mobile companion shares tokens only, never components.
2. **Entity/relationship model** — resolved by **ADR-0005**: deferred. **React Flow is
   therefore not a v1 dependency.** It is re-evaluated when the intelligence layer is built.

React Flow stays in the adopted table as the chosen technology *for when that happens*, not as
something to install now.
