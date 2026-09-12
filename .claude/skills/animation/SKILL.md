---
name: animation
description: Motion policy — the purpose test, duration and easing budgets, reduced-motion handling, GPU-friendly properties, and the different rules for the application versus marketing. Use when adding or reviewing any animation, transition, loading state or visual effect.
---

# Animation

**The test: what does this animation tell the user?**

If the answer is "it looks nice", it does not ship in the application. Marketing has more
latitude; the investigator workspace does not.

## Legitimate purposes

State change · loading and progress · AI processing · navigation and spatial continuity ·
hierarchy on entry · feedback on action · success and error · a relationship becoming visible.

Decoration is not on that list — inside the application.

## Budgets

| | Application | Marketing |
|---|---|---|
| Duration | 120–240ms; 300ms for spatial transitions | up to ~600ms |
| Continuous loops | AI-processing and loading indicators only | Permitted, lazy-loaded |
| WebGL | **None** | Hero only, conditional |
| Properties | `transform`, `opacity` only | Same |
| Stagger | ≤ 3 items | Permitted |

Duration and easing come from tokens (`design-system`), never literals at the call site.

## Non-negotiable

**`prefers-reduced-motion` everywhere.** Not by removing feedback — by replacing *movement*
with an instant state change. The user must still know what happened. A reduced-motion setting
that silently drops a success confirmation is worse than the animation was.

**Never animate layout-triggering properties.** `width`, `height`, `top`, `left`, `margin` and
`padding` cause reflow. Use `transform`. This is the single most common performance mistake in
animated UI.

**Never obscure a state with its own animation.** A contradiction warning or an error must be
legible immediately, not after 300ms of entrance. Animate the arrival, never the legibility.

**Heavy visuals lazy-load** behind an intersection observer, with a static poster, and never
on mobile.

**AI responses render progressively**, not behind a spinner. Progressive rendering is
information; a spinner is an apology.

## Investigator workflow

Animation should reinforce the workflow, not decorate it:

| Event | Treatment |
|---|---|
| New evidence | Subtle entrance — it arrived |
| Verification | Controlled transition, ≤240ms — the state changed deliberately |
| Contradiction | **Static** warning state. Instantly legible. Never animated in |
| AI processing | Unobtrusive continuous indicator, honest about duration |
| Filter or timeline change | Cross-fade between states, not a rebuild |
| Focus change | Movement that explains where you went |

## Reviewing an animation

- [ ] States what it communicates — in a sentence
- [ ] Within the surface's duration budget
- [ ] `transform` / `opacity` only
- [ ] Reduced-motion path replaces movement with an instant state, losing no information
- [ ] Does not delay legibility of an error, warning or evidence state
- [ ] Heavy effects lazy-loaded, poster fallback, not on mobile
- [ ] Duration and easing from tokens
