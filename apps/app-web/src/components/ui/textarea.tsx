// @shadcn/textarea, adopted in T-056 and re-tokenised: `border-control` and the app's one focus
// outline in place of the ring; the body size at every width (below 16px, iOS Safari zooms the
// page on focus — responsive-design), so shadcn's `md:text-sm` is gone; `shadow-xs` dropped.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-border-control bg-surface-raised px-3 py-2 text-base transition-colors duration-(--duration-fast) ease-standard placeholder:text-text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
