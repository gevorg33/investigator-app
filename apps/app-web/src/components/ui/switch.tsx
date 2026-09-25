'use client';

// @shadcn/switch, adopted in T-123 and re-tokenised: the primary colour when on, `border-control`
// when off (3:1, WCAG 1.4.11), a larger track than shadcn's 18px so it reads on a phone, and no
// ring — the app's one focus outline. The 44px target is the row it sits in: always pair a switch
// with a <label> spanning the row, as the profile's status card does.
import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-7 w-12 shrink-0 items-center rounded-full border-2 transition-colors duration-(--duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-border-control data-[state=unchecked]:bg-surface-sunken',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-5 rounded-full bg-surface-raised shadow-raised transition-transform duration-(--duration-fast) ease-standard data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
