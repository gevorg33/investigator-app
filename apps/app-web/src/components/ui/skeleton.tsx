// @shadcn/skeleton, adopted in T-054 and re-tokenised: the sunken surface, and no pulse for a reader
// who asked for reduced motion — the shape alone says something is on its way.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'animate-pulse rounded-md bg-surface-sunken motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
