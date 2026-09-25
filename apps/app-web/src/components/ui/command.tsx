'use client';

// @shadcn/command (cmdk), adopted in T-054 and re-tokenised: rows 44px tall, 16px search text, no
// ring. CommandDialog and CommandShortcut dropped — the list is used inline, in the filter sheet —
// and with them the dialog component the CLI pulled in.
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-md border border-border-control bg-surface-raised',
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex min-h-11 items-center gap-2 border-b border-border px-3"
    >
      <Search aria-hidden className="size-4 shrink-0 text-text-muted" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'flex min-h-11 w-full bg-transparent text-base outline-hidden placeholder:text-text-muted',
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-72 overflow-x-hidden overflow-y-auto p-1', className)}
      {...props}
    />
  );
}

function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm text-text-muted"
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex min-h-11 cursor-default items-center gap-2 rounded-sm px-3 text-sm select-none data-[selected=true]:bg-surface-sunken [&_svg]:pointer-events-none [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandEmpty, CommandInput, CommandItem, CommandList };
