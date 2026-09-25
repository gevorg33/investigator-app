'use client';

// @shadcn/radio-group, adopted in T-119 and re-tokenised: a 20px ring in `border-control` (3:1,
// WCAG 1.4.11), the primary colour when chosen, and no ring of its own — the app's one focus
// outline. The 44px target is the row: always pair an item with a <label> spanning the row.
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'grid size-5 shrink-0 place-content-center rounded-full border-2 border-border-control bg-surface-raised transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="size-2.5 rounded-full bg-primary"
      />
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
