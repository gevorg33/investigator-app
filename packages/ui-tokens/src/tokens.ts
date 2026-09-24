/**
 * The design tokens (design-system skill, ui-architecture-plan §2). One source, consumed by the
 * web apps as CSS custom properties (`tokens.css`, generated from this file) and by the mobile
 * companion as values, if it ever resumes (ADR-0009). This file is the only place in the product
 * where a raw colour, length or duration may be written.
 *
 * Three rules hold here:
 * 1. **Semantic roles, not literal names.** `surface-raised`, never `gray-100`. Dark mode swaps
 *    a role's value; nothing downstream hunts for literals.
 * 2. **A new token is a deliberate addition**, reviewed like code — not a value someone needed
 *    once. Reuse before adding.
 * 3. **Every text/background pairing meets WCAG AA in both themes.** `CONTRAST_PAIRS` names the
 *    pairings the UI makes, and a test measures each one.
 */

/** Colour roles. Every role exists in both themes — a test holds the two key sets equal. */
export type ColorRole =
  // Where things sit
  | 'surface'
  | 'surface-raised'
  | 'surface-sunken'
  | 'surface-overlay'
  // Text
  | 'text'
  | 'text-muted'
  // Boundaries: `border` is decoration; `border-control` outlines something you operate, and
  // meets 3:1 against the surface (WCAG 1.4.11)
  | 'border'
  | 'border-control'
  | 'focus-ring'
  // The one action colour, and what sits on it
  | 'primary'
  | 'primary-contrast'
  | 'primary-subtle'
  // Status
  | 'danger'
  | 'danger-contrast'
  | 'success'
  | 'success-contrast'
  | 'warning'
  | 'warning-contrast'
  // Evidence classes (evidence-integrity). Rendered as text or icon colour beside a label —
  // never as the only carrier of meaning
  | 'evidence-fact'
  | 'evidence-claim'
  | 'evidence-inference'
  | 'evidence-hypothesis'
  | 'evidence-unknown'
  | 'evidence-contradicted'
  | 'ai-unreviewed';

export type Theme = 'light' | 'dark';

export const colors: Readonly<Record<Theme, Readonly<Record<ColorRole, string>>>> = {
  light: {
    surface: '#f7f7f8',
    'surface-raised': '#ffffff',
    'surface-sunken': '#efeff1',
    'surface-overlay': '#ffffff',
    text: '#18181b',
    'text-muted': '#52525b',
    border: '#e4e4e7',
    'border-control': '#71717a',
    'focus-ring': '#1d4ed8',
    primary: '#1d4ed8',
    'primary-contrast': '#ffffff',
    'primary-subtle': '#e8eefc',
    danger: '#b91c1c',
    'danger-contrast': '#ffffff',
    success: '#15803d',
    'success-contrast': '#ffffff',
    warning: '#92400e',
    'warning-contrast': '#ffffff',
    'evidence-fact': '#15803d',
    'evidence-claim': '#0369a1',
    'evidence-inference': '#6d28d9',
    'evidence-hypothesis': '#92400e',
    'evidence-unknown': '#52525b',
    'evidence-contradicted': '#b91c1c',
    'ai-unreviewed': '#c2410c',
  },
  dark: {
    surface: '#0f0f11',
    'surface-raised': '#18181b',
    'surface-sunken': '#09090b',
    'surface-overlay': '#1f1f23',
    text: '#f4f4f5',
    'text-muted': '#a1a1aa',
    border: '#27272a',
    'border-control': '#71717a',
    'focus-ring': '#60a5fa',
    primary: '#60a5fa',
    'primary-contrast': '#0b1220',
    'primary-subtle': '#172554',
    danger: '#f87171',
    'danger-contrast': '#1f0a0a',
    success: '#4ade80',
    'success-contrast': '#052e16',
    warning: '#fbbf24',
    'warning-contrast': '#1c1400',
    'evidence-fact': '#4ade80',
    'evidence-claim': '#38bdf8',
    'evidence-inference': '#a78bfa',
    'evidence-hypothesis': '#fbbf24',
    'evidence-unknown': '#a1a1aa',
    'evidence-contradicted': '#f87171',
    'ai-unreviewed': '#fb923c',
  },
};

/**
 * Foreground on background, as the UI actually pairs them, and the ratio each must reach:
 * 4.5 for text, 3 for large text and for the boundary of something you operate (WCAG 1.4.3,
 * 1.4.11). Measured in both themes by a test. Pair a colour in a new way, add it here first.
 */
export const CONTRAST_PAIRS: ReadonlyArray<{
  fg: ColorRole;
  bg: ColorRole;
  min: 4.5 | 3;
}> = [
  ...(['surface', 'surface-raised', 'surface-sunken', 'surface-overlay'] as const).flatMap((bg) => [
    { fg: 'text' as const, bg, min: 4.5 as const },
    { fg: 'text-muted' as const, bg, min: 4.5 as const },
  ]),
  ...(['surface', 'surface-raised'] as const).flatMap((bg) => [
    { fg: 'border-control' as const, bg, min: 3 as const },
    { fg: 'focus-ring' as const, bg, min: 3 as const },
    { fg: 'primary' as const, bg, min: 4.5 as const },
    { fg: 'danger' as const, bg, min: 4.5 as const },
    { fg: 'success' as const, bg, min: 4.5 as const },
    { fg: 'warning' as const, bg, min: 4.5 as const },
    ...(
      [
        'evidence-fact',
        'evidence-claim',
        'evidence-inference',
        'evidence-hypothesis',
        'evidence-unknown',
        'evidence-contradicted',
        'ai-unreviewed',
      ] as const
    ).map((fg) => ({ fg, bg, min: 4.5 as const })),
  ]),
  { fg: 'primary-contrast', bg: 'primary', min: 4.5 },
  { fg: 'danger-contrast', bg: 'danger', min: 4.5 },
  { fg: 'success-contrast', bg: 'success', min: 4.5 },
  { fg: 'warning-contrast', bg: 'warning', min: 4.5 },
  // A selected navigation item: the primary colour on its own tint, and body text on it.
  { fg: 'primary', bg: 'primary-subtle', min: 4.5 },
  { fg: 'text', bg: 'primary-subtle', min: 4.5 },
];

/**
 * One family: the platform's own. Zero bytes to download, no layout shift while a web font
 * loads, and — unlike most web fonts — full Armenian and Cyrillic coverage on every system the
 * launch markets use (frontend-performance: "ship one font family").
 */
export const fonts = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Noto Sans Armenian", Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
} as const;

/**
 * Type scale, `[size, line height]`. `base` is 16px because an input below that makes iOS
 * Safari zoom the page on focus (responsive-design).
 */
export const text = {
  xs: ['0.75rem', '1rem'],
  sm: ['0.875rem', '1.25rem'],
  base: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'],
  xl: ['1.25rem', '1.75rem'],
  '2xl': ['1.5rem', '2rem'],
} as const satisfies Record<string, readonly [string, string]>;

/** The spacing unit. Every spacing utility is a multiple of it — `p-4` is four units. */
export const spacingUnit = '0.25rem';

export const radius = {
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
  xl: '1rem',
  full: '9999px',
} as const;

export const shadow = {
  raised: '0 1px 2px 0 rgb(0 0 0 / 0.06), 0 1px 3px 0 rgb(0 0 0 / 0.1)',
  overlay: '0 10px 30px -5px rgb(0 0 0 / 0.2)',
} as const;

/**
 * Motion (animation skill): 120–240ms in the application, 300ms for a spatial transition. Under
 * `prefers-reduced-motion` every duration becomes 0 — the state still changes, instantly, so
 * nothing the movement said is lost.
 */
export const duration = {
  fast: '120ms',
  base: '180ms',
  slow: '240ms',
  spatial: '300ms',
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0, 1)',
  exit: 'cubic-bezier(0.3, 0, 1, 1)',
} as const;

/** Stacking order, lowest first. A layer between two of these is a new token, not `z-[35]`. */
export const zIndex = {
  base: 0,
  sticky: 10,
  nav: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
} as const;

/**
 * Breakpoints (responsive-design). Base styles are the phone; each of these adds complexity
 * with a `min-width` query. In rem, so they follow the reader's font size.
 */
export const breakpoints = {
  sm: '40rem',
  md: '48rem',
  lg: '64rem',
  xl: '80rem',
} as const;
