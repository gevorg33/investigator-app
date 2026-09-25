'use client';

// @shadcn/checkbox, adopted in T-119 and re-tokenised: a 20px box in `border-control` (3:1, WCAG
// 1.4.11), filled with the primary colour and a tick when checked — shape as well as colour — and
// no ring of its own. The 44px target is the row: always pair it with a <label> spanning the row.
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'grid size-5 shrink-0 place-content-center rounded-sm border-2 border-border-control bg-surface-raised transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-contrast',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <Check aria-hidden className="size-3.5" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
