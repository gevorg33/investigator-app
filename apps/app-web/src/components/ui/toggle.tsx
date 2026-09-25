// @shadcn/toggle, adopted in T-054 for its variants (toggle-group builds on them) and re-tokenised:
// 44px targets only, so the `sm`/`lg` sizes are gone; "on" is the primary tint with its border and
// weight — not colour alone; focus is the app's one outline.
import { cva } from 'class-variance-authority';

export const toggleVariants = cva(
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border-control bg-surface-raised px-4 text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-sunken disabled:pointer-events-none disabled:opacity-50 data-[state=on]:border-primary data-[state=on]:bg-primary-subtle data-[state=on]:font-semibold data-[state=on]:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
);
