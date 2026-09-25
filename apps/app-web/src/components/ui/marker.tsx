// @shadcn/marker, adopted in T-056 and re-tokenised: the muted role, the body-small size; the
// `separator` and `border` variants and `asChild` dropped — a marker here is a line of status in a
// conversation ("Searching the help articles"), never a divider or a link.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Marker({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="marker"
      className={cn(
        'group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-sm text-text-muted [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn('flex size-4 shrink-0 items-center justify-center', className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="marker-content" className={cn('min-w-0 wrap-break-word', className)} {...props} />;
}

export { Marker, MarkerContent, MarkerIcon };
