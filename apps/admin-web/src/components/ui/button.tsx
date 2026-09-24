// @shadcn/button, adopted in T-014. Re-tokenised (design-system): colours come from the token
// mapping in packages/ui-tokens (`bg-primary`, `bg-accent` → our roles). Changed from upstream:
// - `cn` from our own helper (the CLI again wrote an import of the third-party `cn` package);
// - `Slot` from `@radix-ui/react-slot`, not the `radix-ui` umbrella the CLI installed unpinned:
//   the same code, without the 72 other packages it brings for one component;
// - focus is the app's one `:focus-visible` outline — upstream's `outline-none` removed it and
//   drew a `ring-[3px]` instead;
// - `text-white` → `text-destructive-foreground`; the outline border is `border-input`, the
//   control boundary that meets 3:1; `shadow-xs` does not exist here, and was dropped;
// - no `dark:` overrides — the tokens swap under `prefers-color-scheme`;
// - no `aria-invalid` styling — a button is not a field;
// - sizes are at least 44px tall (responsive-design tap targets): upstream's `xs`, `sm`,
//   `icon-xs` and `icon-sm` are gone, `default` is `h-11`;
// - `transition-colors` on the motion tokens, not `transition-all` at Tailwind's default.
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-standard disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2 has-[>svg]:px-3',
        lg: 'h-12 px-6 has-[>svg]:px-4',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
