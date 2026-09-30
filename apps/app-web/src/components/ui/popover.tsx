'use client';

// @shadcn/popover, adopted in T-169 and re-tokenised as the dropdown menu is:
// `@radix-ui/react-popover`, pinned, never the `radix-ui` barrel (the CLI also installed that and
// the third-party `cn` package — both removed); the overlay surface and its shadow token; the app's
// one focus outline in place of `outline-hidden`; `z-(--z-modal)`; no padding or width of its own —
// the caller's content decides both. The enter/exit animation classes need a plugin the app does
// not load, and are gone. Anchor, header, title and description dropped until something needs them.
import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-(--z-modal) max-h-(--radix-popover-content-available-height) rounded-md border border-border bg-surface-overlay text-text shadow-overlay',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
