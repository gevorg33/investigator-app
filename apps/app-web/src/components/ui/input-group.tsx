// @shadcn/input-group, adopted in T-054 and re-tokenised: 44px tall, `border-control`, the app's one
// focus outline drawn around the whole group; the textarea part, buttons inside the group, an addon
// after the input and the `kbd` offsets dropped — the search field needs only a leading icon.
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function InputGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'flex min-h-11 w-full min-w-0 items-center rounded-md border border-border-control bg-surface-raised',
        'has-[[data-slot=input-group-control]:focus-visible]:outline-2 has-[[data-slot=input-group-control]:focus-visible]:outline-offset-2 has-[[data-slot=input-group-control]:focus-visible]:outline-focus-ring',
        className,
      )}
      {...props}
    />
  );
}

/** An icon before the input. */
function InputGroupAddon({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn(
        'order-first flex items-center pl-3 text-text-muted [&>svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({ className, ...props }: ComponentProps<'input'>) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupInput };
