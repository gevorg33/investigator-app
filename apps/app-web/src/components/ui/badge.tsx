// @shadcn/badge, adopted in T-054 and re-tokenised (design-system): colours from the token roles;
// no `asChild` (nothing here renders a badge as a link — a removable filter is a full-size link, not
// a badge), so no Slot; no focus ring, because a badge is never focusable. `warning` added for a
// deadline that is close — carried by its words as well as its colour.
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-contrast',
        secondary: 'bg-primary-subtle text-primary',
        outline: 'border-border text-text-muted',
        warning: 'bg-warning text-warning-contrast',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge };
