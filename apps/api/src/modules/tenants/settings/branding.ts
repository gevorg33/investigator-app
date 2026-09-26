/**
 * An agency's colours, and the one rule they must meet: they cannot make anything unreadable
 * (T-084, tenancy.md §12). The application is never forked per agency — these two colours are
 * the whole of what branding changes, and where they are drawn is on a light surface: reports,
 * emails, and the branded parts of a page, never the app's own chrome or its dark theme.
 */

/**
 * The design tokens these colours are measured against, from `@investigator/ui-tokens` (light
 * theme). Copied rather than imported — this app is CommonJS and the tokens package is ESM — and
 * held equal to the package by `branding.spec.ts`, so a token change cannot leave this behind.
 */
export const REFERENCE = {
  /** The light theme's page and raised surfaces: what an accent is drawn on. */
  surfaces: ['#f7f7f8', '#ffffff'],
  /** The two text colours a branded fill may carry: light's `primary-contrast` and `text`. */
  light: '#ffffff',
  dark: '#18181b',
} as const;

/** WCAG 2.2: non-text contrast (1.4.11) and normal text (1.4.3). */
export const MIN_UI_CONTRAST = 3;
export const MIN_TEXT_CONTRAST = 4.5;

export const HEX = /^#[0-9a-f]{6}$/;

/** WCAG 2.2 relative luminance of an sRGB colour, `#rrggbb`. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** The WCAG contrast ratio of two colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour that reads best on a fill: the light or the dark one, whichever contrasts more. */
export function textOn(fill: string): string {
  return contrast(fill, REFERENCE.light) >= contrast(fill, REFERENCE.dark)
    ? REFERENCE.light
    : REFERENCE.dark;
}

/**
 * Why a colour cannot be used, or null if it can.
 *
 * - An **accent** marks things on a light surface — a rule, a heading, a button — so it must stand
 *   out from every light surface by 3:1, and whatever is written on it must read at 4.5:1.
 * - A **report header** is a fill with text on it: only the second rule applies.
 */
export function brandingProblem(
  role: 'accent' | 'reportHeader',
  colour: string,
): 'LOW_CONTRAST_SURFACE' | 'LOW_CONTRAST_TEXT' | null {
  if (
    role === 'accent' &&
    REFERENCE.surfaces.some((surface) => contrast(colour, surface) < MIN_UI_CONTRAST)
  ) {
    return 'LOW_CONTRAST_SURFACE';
  }
  if (contrast(colour, textOn(colour)) < MIN_TEXT_CONTRAST) return 'LOW_CONTRAST_TEXT';
  return null;
}
