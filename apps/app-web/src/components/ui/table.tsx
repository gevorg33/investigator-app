// @shadcn/table, adopted in T-093 and re-tokenised: `cn` from our helper (the CLI wrote `cn` the
// npm package); borders and the row tint from our roles; header text muted and the cells at the
// body size. The checkbox selectors and their arbitrary 2px nudge are dropped — nothing here selects
// rows, because the API has no bulk commands. TableFooter and TableCaption dropped until something
// uses them. The container scrolls on its own, so a wide table never scrolls the page; the console
// shows a table only from `md`, and a card list below it (`responsive-design`).
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn('border-b border-border hover:bg-surface-sunken', className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-11 px-3 text-left align-middle text-sm font-medium whitespace-nowrap text-text-muted',
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td data-slot="table-cell" className={cn('px-3 py-2 align-middle', className)} {...props} />
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
