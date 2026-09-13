# UI architecture plan

Companion to `ADR-0003-ui-stack.md`. Planning only — **no UI implemented, no skill or agent
files created.** This document is the decision record that gates that work.

---

## 0. Decisions — resolved

Both gating questions are answered. Recorded in their own ADRs.

| Question | Resolution |
|---|---|
| Workspace surface | **Web-first** — ADR-0004. Next.js web is the primary product workspace; Expo is a companion for capture, notifications, messaging, quick updates and location-aware actions. This plan applies in full to web; mobile shares **tokens only, never components** |
| Entity/relationship model | **Deferred** — ADR-0005. No intelligence layer in v1, **React Flow is not a v1 dependency**, and no abstraction is built for it either. Five concrete constraints keep it cheap to add later |

The rule both follow, now in `CLAUDE.md` as non-negotiable 8:

```
Domain Model → Application Capability → UI → Visualisation
```

Never the reverse. No table is created to satisfy a visual component.

**Resolved:** Sources, Notes, Tasks and Documents are **v1 schema**, specified in `plan.md`
§8 and tracked as T-031–T-033. "Investigation" is the Assignment — no separate entity. The UI
patterns in §8 below now have real data behind every row except the graph.

---

## 1. Library evaluation

Verified against sources, not assumed. Licence column is the one to read.

### Adopt

| Library | Purpose | Strengths | Weaknesses | License | a11y | Mobile | shadcn fit |
|---|---|---|---|---|---|---|---|
| **shadcn/ui** | Foundation | Copy-in source we own; Radix a11y primitives; token-native | Not a package — updates are manual | MIT | Strong (Radix) | Good | Is the baseline |
| **Cult UI** | Polished animated components | shadcn-compatible copy-in; explicitly built for AI-product interfaces | Smaller catalogue; Motion dependency | Open source | Inherits Radix where used | Good | Native |
| **React Bits** | Expressive components | ~110 components; TS + Tailwind variants; copy-in | Marketing-weighted; several are decorative-only | **MIT + Commons Clause** | Varies per component — audit each | Varies | Compatible |
| **Motion** | Animation primitive | Declarative, layout animations, reduced-motion aware, mature | Bundle cost if used casually | MIT | Respects `prefers-reduced-motion` | Good | Cult UI's own dep |
| **React Flow / XYFlow** | Node graph | Purpose-built; virtualised; keyboard support | Real learning curve; needs a data model | **MIT core** | Reasonable, needs work | Poor on small screens | Neutral |

### Adopt conditionally

| Library | Condition | Why the caution |
|---|---|---|
| **Shader Gradient** | Marketing hero only; lazy, poster fallback, off under reduced motion, never mobile | Pulls three.js + @react-three/fiber — the heaviest payload on the page whose Core Web Vitals matter most |
| **Anime.js** | Sequenced SVG only, where Motion genuinely cannot | MIT and excellent, but a second general-purpose animation library is how visual languages diverge |
| **Remotion** | Only when a video deliverable is scheduled; build-time, never runtime | **Paid Company License at 4+ employees** |

### Not dependencies

| Candidate | Reality | Use |
|---|---|---|
| **Haikei** | Browser tool generating SVG. Not installable | Export static SVG, commit as assets, adapt colours to tokens |
| **Refero** | Design-reference gallery of real product screens. **Has an MCP** | Research; candidate MCP (§3) |
| **Webild, Nexflow, FintechX, Verseo, Galilee, DreamMotion** | **Webflow / Framer templates.** Not React. Cannot be installed | Visual inspiration only |
| **Manus** | Autonomous AI agent platform | Not a UI library; out of scope |
| **cloud.craft** | **Could not identify with confidence** | Confirm what was meant before evaluating |

### Worth considering, not on the original list

- **Radix Primitives** — already beneath shadcn; reach for it directly for custom a11y work
  rather than hand-rolling focus management.
- **Recharts / visx** — evidence and confidence charts. `dataviz` guidance applies.
- **TanStack Table** — headless, pairs with shadcn `data-table`. The admin queues need
  server-side pagination (`docs/api/pagination.md`), which TanStack handles cleanly.
- **cmdk** — command palette; already shadcn's `command` dependency.

---

## 2. Design tokens

One source, consumed by both surfaces. This is what makes the product feel designed rather
than assembled, and it is the first thing to build.

`packages/ui-tokens/` exporting: colour (semantic roles, not hex names — `surface`,
`surface-raised`, `border-subtle`, `text-muted`, plus evidence-state roles), typography
scale, spacing scale, radius, shadow, **motion durations and easings**, z-index scale,
breakpoints.

Three rules:

1. **Every adopted component is re-tokenised before merge.** A component keeping its own
   palette or radius is the drift this whole plan exists to prevent.
2. **No raw values in feature code.** No hex, no `ms`, no arbitrary Tailwind values.
   Lint-enforced.
3. **Semantic roles, not literal names.** `evidence-verified`, not `green-500`. Dark mode
   then swaps role values rather than hunting literals.

Evidence-state roles map to the `evidence-integrity` classification — `FACT`, `CLAIM`,
`INFERENCE`, `HYPOTHESIS`, `UNKNOWN`, plus `contradicted` and `unverified-ai`. Those states
are already in the data model, so the UI should not invent a parallel vocabulary.

---

## 3. MCP strategy

| Tier | MCP | Why |
|---|---|---|
| **MUST** | **shadcn** | Already installed and smoke-tested. Registry search is the component-reuse rule's enforcement mechanism |
| **MUST** | **Playwright** | Visual QA, responsive checks, reduced-motion verification, a11y snapshots. §7 depends on it |
| **SHOULD** | **Context7** (or equivalent docs MCP) | Version-correct API docs for Motion, React Flow, Next.js. Reduces invented APIs |
| **SHOULD** | **Refero** | 142k real product screens and 12k user flows, with an MCP. The research input for `interaction-design` — proven patterns beat invented ones, and it adds no build dependency |
| **OPTIONAL** | **Figma** | Only if design actually originates in Figma. Otherwise it is a tool with nothing to read |
| **OPTIONAL** | **GitHub** | `gh` CLI already covers most of it |
| **AVOID** | Anything per-library | Cult UI and React Bits are reachable through the shadcn registry mechanism. A separate MCP per component source is exactly the sprawl being avoided |

Registries in `components.json` — namespaced `@shadcn`, `@cult-ui`, `@react-bits` —
allowlisted per the `component-discovery` skill, which requires source review for
anything outside `@shadcn`.

---

## 4. Skills to create

Not fifteen. The proposed list has heavy overlap — `design-system` / `visual-design` /
`ui-documentation` are one concern; `shadcn` / `react-bits` / `cult-ui` /
`component-discovery` are one procedure. Seven, each a distinct procedure:

| Skill | Purpose | Invoked | Enforces | Output |
|---|---|---|---|---|
| **`ui-architecture`** | The hierarchy and where each library may be used | Any UI work | Adopted/rejected list; marketing-vs-app boundary; escalation path | Which layer to use, and why |
| **`design-system`** | Tokens: definition, consumption, adaptation | Adding a component, touching visual style | No raw values; semantic roles; re-tokenise on adoption; dark/light parity | Token-conformant component |
| **`component-discovery`** | The mandatory reuse search | **Before any new component** | Search order; reuse over rebuild; no duplicates; source review outside `@shadcn` | Chosen component + rationale, or a justified custom decision |
| **`animation`** | Motion policy | Any animation | Purpose test; reduced-motion; GPU-friendly only; duration/easing from tokens; app-vs-marketing budget | Animation that communicates, or none |
| **`frontend-accessibility`** | a11y beyond Radix defaults | New interaction, graph, custom control | Keyboard paths; focus management; contrast; live regions; the graph specifically | a11y findings, blocking |
| **`frontend-performance`** | Budgets and heavy effects | Adding a dependency, a visual effect, or a route | Bundle budgets; lazy-load heavy visuals; Core Web Vitals on marketing; no layout-triggering animation | Measured before/after |
| **`visual-qa`** | Playwright verification loop | Before shipping any UI | Three viewports; reduced-motion pass; a11y snapshot; regression baselines | Screenshots + diff verdict |

The former `shadcn-ui` skill was folded into `component-discovery` rather than duplicated.

Deliberately **not** separate skills: `motion-design` (part of `animation`), `ux-review`
(that is `visual-qa` plus Refero research), `visual-design` (part of `design-system`),
`ui-documentation` (the existing `documentation-first` rule already covers it),
~~`responsive-design`~~ — **reversed.** Now its own skill: with the companion app deferred
(ADR-0009) the responsive web app is the only phone experience, which makes mobile-first a
substantial procedure rather than a check inside `visual-qa`.

---

## 5. Agents to create

Two, not nine. The proposed roster would have six agents editing the same components — which
the existing concurrency rule in `AGENTS.md` forbids anyway.

| Agent | Writes? | Owns |
|---|---|---|
| **`frontend`** | Yes | All UI implementation on both surfaces. Loads the skills above |
| **`frontend-review`** | **No** | Read-only review: token conformance, a11y, animation policy, performance budgets, visual regression |

Rationale: `ui-architect`, `design-system-agent`, `component-research-agent` and
`animation-agent` are not different *specialisations* — they are the same agent following
different skills at different moments. Splitting them creates handoff cost and concurrent
writers on one file.

`frontend-review` is read-only for the same reason `security-privacy` and `qa-reviewer` are:
review stays independent of authorship.

---

## 6. CLAUDE.md additions

Two non-negotiables, short — detail lives in skills:

> **9. Reuse before building.** Before creating any component, animation, card, modal,
> navigation element, loading state or effect: search the configured registries
> (`@shadcn` → `@cult-ui` → `@react-bits`), then check whether an existing project component
> adapts. Build custom only when nothing fits, and document why. See `component-discovery`.
>
> **10. One visual language.** Every adopted component is adapted to the design tokens before
> merge. No raw colours, spacing, radii or durations in feature code. The application
> prioritises `clarity > performance > usability > visual effect`; marketing may be more
> expressive but never at the cost of Core Web Vitals, accessibility or mobile performance.

Plus a stack line in the table pointing at ADR-0003.

---

## 7. Animation policy

**The test: what does this animation tell the user?** If the answer is "it looks nice", it
does not ship in the application.

Legitimate in-app purposes: state change · loading and progress · AI processing · navigation
and spatial continuity · hierarchy on entry · feedback on action · success and error.

| Budget | Application | Marketing |
|---|---|---|
| Duration | 120–240ms; 300ms for spatial transitions | up to ~600ms |
| Continuous loops | Only AI-processing and loading indicators | Permitted, lazy-loaded |
| WebGL | None | Hero only, conditional |
| Properties | `transform` and `opacity` only | Same |
| Stagger | ≤ 3 items | Permitted |

Non-negotiable rules:

- **`prefers-reduced-motion` honoured everywhere** — not by disabling feedback, but by
  replacing movement with an instant state change. The user must still know what happened.
- **Never animate layout-triggering properties.** `width`, `height`, `top`, `margin` cause
  reflow. Use `transform`.
- **No animation on evidence state that obscures the state itself.** A contradiction warning
  must be legible immediately, not after an animation completes.
- **Heavy visuals lazy-load** behind an intersection observer with a static poster.
- **AI responses render progressively**, not behind a spinner — progressive rendering is
  information; a spinner is an apology.

---

## 8. Investigator UX patterns

*Graph row is **deferred** per ADR-0005 and shown for future reference only. Every other row is buildable against the existing schema.*

| Stage | Pattern | Animation |
|---|---|---|
| Planning | Task list — `InvestigationTask`, private by default | None beyond focus |
| Research / Sources | `InvestigationSource` list; reliability badge + rationale | Entry stagger ≤3 |
| Evidence | Evidence card: class badge, checksum state, capture time | Subtle entrance on new |
| Verification | Explicit state transition, never ambiguous | Controlled, ≤240ms |
| Contradictions | **Both positions side by side**, never a resolved winner | Static warning state — legible instantly |
| Entities / Relationships | React Flow — **not v1** (ADR-0005) | *future* |
| Timeline | Horizontal scrubber, evidence-linked | Cross-fade between filters |
| Analysis / Report | Section editor; AI text visibly marked unreviewed | Progressive render for AI drafts |

Two constraints carried from existing skills, not new inventions:

- `evidence-integrity` — the UI must render assertion **class**, never flatten to prose, and
  must show contradictions as conflicts rather than resolving them visually.
- `report-generation` — AI-drafted text is marked `unverified` **in the data model**; the UI
  reflects that state, it does not create it.

---

## 9. Visual QA

```
implement → run → Playwright → desktop 1440 / tablet 768 / mobile 375
         → reduced-motion pass → a11y snapshot → perf budget → diff vs baseline → fix → re-verify
```

Baselines for: marketing home and pricing · auth · dashboards (both roles) · evidence list
and detail · report editor · graph (when it exists) · assistant panel.

Review in three states each — loading, empty, error — because those are where design systems
actually break, and where `mobile-screen` already requires coverage.

---

## 10. Recommended implementation order

1. ~~Gating decisions.~~ **Done** — ADR-0004, ADR-0005; workspace schema specified (T-031–T-033).
2. Design tokens package — before any component, so nothing needs re-tokenising later.
3. shadcn init in `app.` and marketing (T-014 exists, blocked on the monorepo).
4. Create the seven skills and two agents.
5. Playwright MCP + visual QA loop, with baselines from the first real screens.
6. Application shell: navigation, auth screens, dashboard skeleton. Deliberately unglamorous.
7. Evidence and report surfaces — the product's actual value.
8. Marketing site with SEO (T-024), expressive layer added last.
9. Shader Gradient hero, lazy, measured against Core Web Vitals before it stays.
10. Graph — **not in this plan's horizon.** Revisited when ADR-0005 is superseded.

Note the order: the application's functional core precedes marketing expressiveness, and the
graph is last because it is the only item with an unmet data dependency.

---

## 11. Open items

- `cloud.craft` — unidentified; confirm what was meant
- React Bits' Commons Clause → dependency review with counsel
- Remotion Company License → only if video is scheduled
- Haikei commercial terms → confirm before assets ship
- Per-component a11y audit for React Bits — quality varies; treat each as third-party source
  per the `component-discovery` review rule
