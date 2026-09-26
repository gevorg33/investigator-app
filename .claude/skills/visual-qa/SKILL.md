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

## The tool

`.mcp.json` pins the Playwright MCP to **`@playwright/mcp@0.0.81`** (T-137), never `@latest` —
the same version policy as CLAUDE.md's pinned table. Chosen 2026-09-26: 0.0.81 was 12 days old
and carries a fix for symlinks escaping the file-access roots; 0.0.82 was 8 days old, younger
than the ESLint release CLAUDE.md turned down. It depends on a `playwright` 1.64 alpha — every
recent `@playwright/mcp` does, there is no stable-core build to prefer.

**Before bumping:** read the release notes (`gh release view vX -R microsoft/playwright-mcp`),
check the age, then run `npx -y @playwright/mcp@<version> --help` and a navigate + snapshot
against the new version before changing `.mcp.json`. Tool names change between releases
(0.0.82 replaced `browser_webmcp_*`), so update any tool name this skill mentions.

## Viewports

| Name | Size | Watch for |
|---|---|---|
| Desktop | 1440×900 | The primary workspace target |
| Tablet | 768×1024 | Where multi-pane layouts break first |
| Mobile | 375×812 | Web app in a phone browser — **not** the companion app |

**Mobile web is the only phone experience this product has** — the companion app is deferred
(ADR-0009). Treat 375px as a primary target, not a check at the end.

Additional touch checks are in `responsive-design`: no horizontal page scroll, tap targets
≥ 44px, every hover affordance has a tap path, and the keyboard does not obscure the active
input.

## Three states, always

Loading, empty, and error — for every screen that loads data. This is where design systems
actually break, and `mobile-screen` already requires the same coverage.

A screenshot of the success state only is not a review.

## Reduced-motion pass

Emulate `prefers-reduced-motion: reduce` and confirm the rules below. On 0.0.81 there is no
media-emulation tool (`browser_emulate_media` arrives in 0.0.82), so call
`browser_run_code_unsafe` with:

```js
async (page) => { await page.emulateMedia({ reducedMotion: 'reduce' }); }
```

The emulation lasts for the page until it is cleared with `reducedMotion: null`. Then confirm:

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
