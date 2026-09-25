// @shadcn/input, adopted in T-127 and re-tokenised: 44px tall; 16px text at every width (below
// that, iOS zooms the page on focus — so shadcn's `md:text-sm` is gone); the control boundary is
// `border-control` (3:1, WCAG 1.4.11); focus is the app's one outline.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'min-h-11 w-full min-w-0 rounded-md border border-input bg-surface-raised px-3 py-2 text-base transition-colors duration-(--duration-fast) ease-standard placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
