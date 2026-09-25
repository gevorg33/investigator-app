// @shadcn/bubble, adopted in T-056 and re-tokenised: two variants of seven — `default` (the
// person's own words, on the primary colour: a pair CONTRAST_PAIRS already measures) and `ghost`
// (the assistant's, as plain text at full width). `secondary`, `muted`, `tinted`, `outline` and
// `destructive` dropped: `tinted` was built from `oklch()` literals and the rest had no speaker to
// serve. `BubbleReactions` dropped — nobody reacts to an assistant. `Slot` from
// `@radix-ui/react-slot`, never the `radix-ui` barrel (T-054); `rounded-xl` and the body size from
// tokens; the focus ring is the app's one outline.
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const bubbleVariants = cva(
  'group/bubble relative flex w-fit max-w-4/5 min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full',
  {
    variants: {
      variant: {
        default:
          '*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-contrast',
        ghost:
          '*:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Bubble({
  variant = 'default',
  align = 'start',
  className,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof bubbleVariants> & { align?: 'start' | 'end' }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="bubble-content"
      className={cn(
        'w-fit max-w-full min-w-0 overflow-hidden rounded-xl px-3 py-2 leading-relaxed wrap-break-word whitespace-pre-wrap group-data-[align=end]/bubble:self-end',
        className,
      )}
      {...props}
    />
  );
}

export { Bubble, BubbleContent };
