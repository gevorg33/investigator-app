'use client';

// @shadcn/progress, adopted in T-119 and re-tokenised: the primary colour on the sunken surface,
// tall enough to read on a phone, and the app's own motion token — a step's progress moves, it does
// not bounce. Always give it an accessible name (`aria-label`) and say the step in words beside it:
// the bar alone is not the information.
import * as ProgressPrimitive from '@radix-ui/react-progress';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Progress({
  className,
  value,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root> & { value: number }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full bg-primary transition-transform duration-(--duration-fast) ease-standard"
        style={{ transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
