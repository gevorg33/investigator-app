// @shadcn/alert, adopted in T-127 and re-tokenised: flex instead of shadcn's arbitrary grid
// columns; and `role="alert"` only for the destructive variant — an error after a submit is
// announced at once, a standing notice is not (frontend-accessibility: announce what changed,
// not everything on the page).
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'border-border bg-card text-card-foreground',
        destructive: 'border-destructive bg-card text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

/** Title and description sit in one column beside the icon. */
function AlertContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="alert-content" className={cn('grid min-w-0 gap-1', className)} {...props} />
  );
}

function AlertTitle({ className, ...props }: ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('font-medium', className)} {...props} />;
}

export { Alert, AlertContent, AlertTitle };
