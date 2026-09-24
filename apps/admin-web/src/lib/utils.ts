import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui's class helper: join conditionally, then let later classes win.
 *
 * tailwind-merge needs no teaching for our token names — it already treats `shadow-raised` and
 * `shadow-overlay` as one property, and `text-sm` and `text-text-muted` as two (T-091 checked,
 * and `utils.spec.ts` keeps checking, in case an upgrade changes that).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
