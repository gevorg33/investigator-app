// @shadcn/card, adopted in T-054 and re-tokenised: the raised surface and its token shadow; a
// phone-first inset (px-4) that grows from `md`; `CardTitle` is an `h3`, not a div, so a list of
// cards reads as a list of headed items; CardAction and CardDescription dropped until something
// uses them. The header's one column is `minmax(0, 1fr)`, not the implicit `auto`: an `auto` column
// grows to the widest unbreakable word in it — a category name, a pasted address — and takes the
// card, and the page, past a phone's edge (T-178).
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-4 rounded-lg border border-border bg-surface-raised py-4 shadow-raised md:py-5',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn('grid grid-cols-1 gap-2 px-4 md:px-5', className)}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return (
    <h3
      data-slot="card-title"
      // A title is often someone's own words; one with nowhere to break (a pasted address) wraps
      // inside the card rather than running past it (T-178).
      className={cn('text-lg leading-snug font-semibold break-words', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-4 md:px-5', className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 pt-4 md:px-5',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardContent, CardFooter, CardHeader, CardTitle };
