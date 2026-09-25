'use client';

// @shadcn/toggle-group, adopted in T-054 and re-tokenised: chips that wrap on a phone rather than a
// joined segmented bar that overflows it, so the spacing variants and their context are gone. Radix
// supplies the roving focus and `aria-pressed` / `role="radio"` semantics.
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { toggleVariants } from './toggle';

function ToggleGroup({ className, ...props }: ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn('flex flex-wrap gap-2', className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleVariants(), className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
