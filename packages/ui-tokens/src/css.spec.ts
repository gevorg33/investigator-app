import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SHADCN_COLORS, toCss } from './css.js';
import { colors, duration, type ColorRole } from './tokens.js';

const css = toCss();

describe('tokens.css', () => {
  it('is what the tokens generate — regenerate with `pnpm --filter @investigator/ui-tokens tokens:css`', () => {
    expect(readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')).toBe(css);
  });

  it('declares every role for light at the root, and swaps it for dark under the system setting', () => {
    const [light, rest] = css.split('@media (prefers-color-scheme: dark)') as [string, string];
    const dark = rest.split('@media (prefers-reduced-motion')[0]!;
    for (const [role, value] of Object.entries(colors.light)) {
      expect(light).toContain(`--${role}: ${value};`);
    }
    for (const [role, value] of Object.entries(colors.dark)) {
      expect(dark).toContain(`--${role}: ${value};`);
    }
    expect(dark).toContain('color-scheme: dark;');
  });

  it('turns every duration to zero under reduced motion — the change stays, the movement goes', () => {
    const reduced = css.split('@media (prefers-reduced-motion: reduce)')[1]!.split('@theme')[0]!;
    for (const name of Object.keys(duration)) expect(reduced).toContain(`--duration-${name}: 0ms;`);
  });

  it('removes Tailwind’s own palette and scales, so a raw colour is not a utility', () => {
    for (const reset of [
      '--color-*',
      '--text-*',
      '--radius-*',
      '--shadow-*',
      '--ease-*',
      '--breakpoint-*',
    ]) {
      expect(css).toContain(`${reset}: initial;`);
    }
  });

  it('exposes each role as a utility through its variable, so dark mode reaches it', () => {
    const inline = css.split('@theme inline')[1]!;
    for (const role of Object.keys(colors.light)) {
      expect(inline).toContain(`--color-${role}: var(--${role});`);
    }
    expect(inline).toContain('--text-base: 1rem;');
    expect(inline).toContain('--text-base--line-height: 1.5rem;');
    expect(inline).toContain('--spacing: 0.25rem;');
    expect(inline).toContain('--breakpoint-md: 48rem;');
  });

  it('maps every shadcn colour name onto a role that exists', () => {
    const roles = new Set(Object.keys(colors.light));
    for (const [name, role] of Object.entries(SHADCN_COLORS)) {
      expect(roles.has(role as ColorRole)).toBe(true);
      expect(css).toContain(`--color-${name}: var(--${role});`);
    }
    // The trap in shadcn's naming: its `accent` is a hover tint, not the brand colour.
    expect(SHADCN_COLORS['accent']).toBe('primary-subtle');
  });
});
