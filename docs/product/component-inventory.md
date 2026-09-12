# Component inventory

Every reusable UI component, so the next agent does not rebuild what exists. Updated in the
**same task** that adds a component — see `component-discovery`.

| Component | Source | Used in | Notes |
|---|---|---|---|
| _(none yet)_ | | | |

## Columns

- **Source** — `@shadcn`, `@cult-ui`, `@react-bits`, or `custom`
- **Notes** — for `custom`, why nothing existing fit. This is the field that stops the same
  custom component being written twice

## Before adding a row

The component was searched for first, its source was read if outside `@shadcn`, and it was
re-tokenised. If any of those did not happen, it is not ready for the inventory.
