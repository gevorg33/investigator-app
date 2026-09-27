import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The utilities `globals.css` defines itself, told to tailwind-merge by the property each sets.
 * Unknown to it, `max-h-sheet` stayed beside a later `max-h-dvh` and won the cascade: the
 * assistant's phone sheet was 85% of the screen, not all of it (T-166).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'max-h': [{ 'max-h': ['sheet'] }],
      pb: [{ pb: ['safe', 'bottom-nav'] }],
    },
  },
});

/**
 * shadcn/ui's class helper: join conditionally, then let later classes win.
 *
 * tailwind-merge needs no teaching for our token names — it already treats `shadow-raised` and
 * `shadow-overlay` as one property, and `text-sm` and `text-text-muted` as two (T-091 checked,
 * and `utils.spec.ts` keeps checking, in case an upgrade changes that). Our own `@utility`
 * classes are another matter: each is listed above.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
