---
name: interaction-design
description: Designing flows and screens for simplicity — the subtraction test, progressive disclosure, defaults, reducing clutter, empty states, and which micro-interactions earn their place. Use before laying out a screen or flow, and when a design feels busy or a flow feels long.
---

# Interaction design

The other UI skills answer *"how do I build this well?"* This one asks *"should this exist,
and can it be smaller?"*

**The bar: a user should never have to think about the interface, only about their work.**

## The subtraction test

Before adding a control, field, step, setting or panel:

1. **Can it be removed?** What breaks if it is not there?
2. **Can it be a default instead of a choice?** A good default removes a decision. Mission
   category from the customer's last mission, locale from the browser, currency from country.
3. **Can it be inferred?** If the answer is derivable, do not ask.
4. **Can it wait?** Something needed by 10% of users on 5% of visits is not a first-screen
   element.

Adding is the easy move and it compounds. Every control added is one every user reads past
forever.

## Flows: count decisions, not screens

A three-step flow with one decision each is easier than one screen with twelve fields. People
measure effort in choices, not page loads.

- Group by the user's mental model, not the database schema
- One primary action per screen, visually obvious. Secondary actions look secondary
- Never present a decision the user has no basis to make — if they cannot answer, you asked
  the wrong question or asked it too early
- Show progress on anything over two steps
- Preserve work on back-navigation. Losing input is the most expensive failure in a flow

**Mission creation is the hardest flow in this product.** It needs a lot legally — category,
scope, location, timeframe, budget, lawful basis, attachments — and must still feel short.
Multi-step, one concern per step, progress visible, every answer preserved.

## Progressive disclosure

Show what most people need; put the rest behind a clear affordance.

- The 80% case is the default view
- **Never hide something required.** Disclosure is for optional depth, never for a field that
  blocks completion
- An "advanced" section must be findable — a label, not an icon
- Disclosure is not an excuse to keep a control that failed the subtraction test

## Clutter has specific sources

It is rarely one bad decision; it is many small additions nobody removed:

| Source | Fix |
|---|---|
| Redundant labels — a heading and a label saying the same thing | Delete one |
| Decorative icons beside clear text | Remove; icons carry meaning or go |
| Borders where whitespace would separate | Use space |
| Status shown three ways — colour, badge, text | Pick the accessible one, drop the rest |
| Every action always visible | Primary visible, secondary in a menu |
| Filled empty states | See below |

**Whitespace is not wasted space.** It is what makes the content readable.

## Empty states are the highest-value screen

They are the first thing a new user sees and usually the least designed. Each is a teaching
moment:

- **No missions yet** — explain what a mission is and how to start one
- **No quotes yet** — say what happens next and roughly when
- **No evidence yet** — say who will add it and when it appears
- **Search with no results** — say what was searched and what to change

An empty state that says "No data" wastes the only moment the user is guaranteed to read the
screen.

## Micro-interactions that earn their place

Per `animation`, every animation states what it communicates. The ones that reliably do:

- **State change** — something is now verified, sent, saved
- **Optimistic feedback** — the tap registered, before the server replies
- **Loading → content** — a transition rather than a flash
- **Arrival of something important** — new evidence, a new quote
- **Error** — a movement that draws the eye without alarming

The ones that do not: decorative hover, entrance animation on every card in a list, parallax,
anything that plays on a screen the user visits fifty times a day.

**Frequency inverts the rule.** A delightful animation on first use is an irritation on the
five-hundredth. The moderation queue and the evidence list are used repeatedly — there,
restraint *is* the polish.

## Optimise for the second hundred uses

Ask who uses a screen, and how often:

| Surface | Optimise for |
|---|---|
| Marketing, onboarding, registration | **First use.** Explanation, guidance, reassurance |
| Mission creation | First use — most customers do it rarely |
| Evidence list, report editor | **Repeat use.** Speed, keyboard, density |
| Moderation queue | **Heavy repeat use.** A moderator does this hundreds of times — keyboard-driven, minimal chrome, no confirmation friction on the common path |

A first-use-optimised design on a repeat-use screen becomes an obstacle.

## Let the content be the interface

Where the content *is* the product, chrome should recede. Evidence review is media and its
metadata — the toolbar should get out of the way. The assistant is a conversation; wrapping it
in controls makes it worse, not more capable.

## Checklist

- [ ] Every control survives the subtraction test
- [ ] Defaults chosen so the common path needs no decisions
- [ ] One obvious primary action per screen
- [ ] Nothing required hidden behind disclosure
- [ ] No redundant label, decorative icon, or triple-encoded status
- [ ] Empty states teach rather than report emptiness
- [ ] Every animation communicates; none repeat-annoy on a high-frequency screen
- [ ] Design matches the use frequency of the surface
- [ ] Back-navigation preserves work
