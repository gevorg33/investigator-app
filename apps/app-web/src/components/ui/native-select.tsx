// @shadcn/native-select, adopted in T-054 and re-tokenised: 44px tall and 16px text (below that,
// iOS zooms on focus); the control boundary is `border-control`; focus is the app's one outline, so
// the ring and `dark:` overrides are gone; the wrapper fills its column unless told otherwise.
// A native select is the right picker on a phone: the platform's own wheel or sheet.
import { ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return (
    <div
      data-slot="native-select-wrapper"
      className="relative w-full has-[select:disabled]:opacity-50"
    >
      <select
        data-slot="native-select"
        className={cn(
          'min-h-11 w-full min-w-0 appearance-none rounded-md border border-border-control bg-surface-raised py-2 pr-10 pl-3 text-base transition-colors duration-(--duration-fast) ease-standard disabled:pointer-events-none',
          className,
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
}

export { NativeSelect };
