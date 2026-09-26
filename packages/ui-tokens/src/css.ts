import {
  breakpoints,
  colors,
  duration,
  easing,
  fonts,
  radius,
  shadow,
  spacingUnit,
  text,
  zIndex,
  type ColorRole,
  type Theme,
} from './tokens.js';

/**
 * shadcn/ui's colour names, mapped onto ours. Components copied in from the registry keep their
 * class names (`bg-card`, `text-muted-foreground`) and so resolve to our roles without an edit —
 * the re-tokenising for colour happens here, once, rather than in every component.
 *
 * Note the one trap: shadcn's `accent` is a hover highlight, not a brand colour. Ours is
 * `primary`, and shadcn's `accent` maps to `primary-subtle`.
 */
export const SHADCN_COLORS: Readonly<Record<string, ColorRole>> = {
  background: 'surface',
  foreground: 'text',
  card: 'surface-raised',
  'card-foreground': 'text',
  popover: 'surface-overlay',
  'popover-foreground': 'text',
  primary: 'primary',
  'primary-foreground': 'primary-contrast',
  secondary: 'surface-sunken',
  'secondary-foreground': 'text',
  muted: 'surface-sunken',
  'muted-foreground': 'text-muted',
  accent: 'primary-subtle',
  'accent-foreground': 'text',
  destructive: 'danger',
  'destructive-foreground': 'danger-contrast',
  border: 'border',
  input: 'border-control',
  ring: 'focus-ring',
};

const declarations = (entries: ReadonlyArray<readonly [string, string | number]>, indent: string) =>
  entries.map(([name, value]) => `${indent}--${name}: ${value};`).join('\n');

const themeColors = (theme: Theme) =>
  Object.entries(colors[theme]) as ReadonlyArray<readonly [ColorRole, string]>;

/**
 * The stylesheet every web surface imports (`@investigator/ui-tokens/tokens.css`).
 *
 * - `:root` holds each role's value, swapped for dark under `prefers-color-scheme` — the system
 *   setting decides, and nothing is stored.
 * - `[data-theme="light"]` puts the light values back for one subtree, whatever the system
 *   setting: for what is only ever measured against the light theme — an agency's branded fills
 *   (T-094), reports and emails. It follows the dark swap, so at equal specificity it wins.
 * - Under `prefers-reduced-motion` every duration is 0: movement becomes an instant state change.
 * - `@theme` resets Tailwind's own palette, radii, shadows, type sizes, easings and breakpoints,
 *   so `bg-red-500`, `rounded-3xl` or `shadow-2xl` do not exist to be reached for. What remains
 *   is these tokens, as utilities: `bg-surface-raised`, `text-text-muted`, `rounded-md`.
 */
export function toCss(): string {
  const root: Array<readonly [string, string | number]> = [
    ...themeColors('light'),
    ...Object.entries(duration).map(([k, v]) => [`duration-${k}`, v] as const),
    ...Object.entries(zIndex).map(([k, v]) => [`z-${k}`, v] as const),
  ];
  const theme: Array<readonly [string, string]> = [
    ...themeColors('light').map(([role]) => [`color-${role}`, `var(--${role})`] as const),
    ...Object.entries(SHADCN_COLORS).map(
      ([name, role]) => [`color-${name}`, `var(--${role})`] as const,
    ),
    ['font-sans', fonts.sans],
    ['font-mono', fonts.mono],
    ...Object.entries(text).flatMap(([k, [size, leading]]) => [
      [`text-${k}`, size] as const,
      [`text-${k}--line-height`, leading] as const,
    ]),
    ['spacing', spacingUnit],
    ...Object.entries(radius).map(([k, v]) => [`radius-${k}`, v] as const),
    ...Object.entries(shadow).map(([k, v]) => [`shadow-${k}`, v] as const),
    ...Object.entries(easing).map(([k, v]) => [`ease-${k}`, v] as const),
    ...Object.entries(breakpoints).map(([k, v]) => [`breakpoint-${k}`, v] as const),
  ];
  return [
    '/*',
    ' * Generated from packages/ui-tokens/src/tokens.ts by',
    ' * `pnpm --filter @investigator/ui-tokens tokens:css`. Do not edit: a test fails when this',
    ' * file and the tokens disagree.',
    ' */',
    '',
    ':root {',
    '  color-scheme: light;',
    declarations(root, '  '),
    '}',
    '',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    '    color-scheme: dark;',
    declarations(themeColors('dark'), '    '),
    '  }',
    '}',
    '',
    '[data-theme="light"] {',
    '  color-scheme: light;',
    declarations(themeColors('light'), '  '),
    '}',
    '',
    '@media (prefers-reduced-motion: reduce) {',
    '  :root {',
    declarations(
      Object.keys(duration).map((k) => [`duration-${k}`, '0ms'] as const),
      '    ',
    ),
    '  }',
    '}',
    '',
    '@theme {',
    '  --color-*: initial;',
    '  --text-*: initial;',
    '  --radius-*: initial;',
    '  --shadow-*: initial;',
    '  --ease-*: initial;',
    '  --breakpoint-*: initial;',
    '}',
    '',
    '@theme inline {',
    declarations(theme, '  '),
    '}',
    '',
  ].join('\n');
}
