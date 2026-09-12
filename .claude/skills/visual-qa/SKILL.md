---
name: visual-qa
description: The Playwright verification loop — three viewports, reduced-motion, accessibility snapshot, performance check and visual regression baselines. Use before shipping any UI change, and when establishing or updating a baseline.
---

# Visual QA

```
implement → run → desktop 1440 / tablet 768 / mobile 375
         → reduced-motion pass → a11y snapshot → perf budget → diff vs baseline → fix → re-verify
```

Verify it yourself. Do not ask the user to check whether it looks right.

## Viewports

| Name | Size | Watch for |
|---|---|---|
| Desktop | 1440×900 | The primary workspace target |
| Tablet | 768×1024 | Where multi-pane layouts break first |
| Mobile | 375×812 | Web app in a phone browser — **not** the companion app |

Mobile web matters even though a companion app exists (ADR-0004): a customer checking a quote
on their phone uses the browser.

## Three states, always

Loading, empty, and error — for every screen that loads data. This is where design systems
actually break, and `mobile-screen` already requires the same coverage.

A screenshot of the success state only is not a review.

## Reduced-motion pass

Emulate `prefers-reduced-motion: reduce` and confirm:

- Nothing is still moving
- **No information was lost** — a state change that was communicated by movement is now
  communicated instantly, not dropped
- Heavy visuals are off, with their poster showing

## Accessibility snapshot

Capture the accessibility tree, not just pixels. Confirm names and roles are real, tab order
is sensible, focus is visible, and async changes are announced. See
`frontend-accessibility`.

## Baselines

Keep regression baselines for: marketing home and pricing · auth · customer dashboard ·
investigator workspace · evidence list and detail · report editor · admin verification queue ·
assistant panel.

**Update a baseline only when the change is intended**, and say so in the commit. A baseline
updated to make a diff go away defeats the entire mechanism — the same discipline as never
weakening a test to get green (`testing`).

Mask genuinely dynamic regions — timestamps, generated IDs — rather than accepting a
permanently noisy diff.

## Reporting

Report what you actually observed, per viewport. If a viewport was not checked, say so rather
than implying it passed.

## Checklist

- [ ] Three viewports captured
- [ ] Loading, empty and error states each seen
- [ ] Reduced-motion pass, no information lost
- [ ] Accessibility snapshot reviewed
- [ ] Performance within budget
- [ ] Diffed against baseline; intended changes explained
