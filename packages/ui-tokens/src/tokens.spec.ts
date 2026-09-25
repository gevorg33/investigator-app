import { describe, expect, it } from 'vitest';
import {
  breakpoints,
  colors,
  CONTRAST_PAIRS,
  duration,
  text,
  zIndex,
  type ColorRole,
  type Theme,
} from './tokens.js';

/** WCAG 2.2 relative luminance of an sRGB hex colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: Theme[] = ['light', 'dark'];

describe('design tokens', () => {
  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    // A published reference pair: #767676 on white is the lightest grey that passes 4.5.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it.each(THEMES)('meets every contrast pairing the UI makes, in %s', (theme) => {
    const failing = CONTRAST_PAIRS.map(({ fg, bg, min }) => ({
      pair: `${fg} on ${bg}`,
      ratio: Math.round(contrast(colors[theme][fg], colors[theme][bg]) * 100) / 100,
      min,
    })).filter((p) => p.ratio < p.min);
    expect(failing).toEqual([]);
  });

  it('pairs every text, status and evidence colour with a background somewhere', () => {
    // A foreground role nobody measured is one that can drift below AA unnoticed.
    const backgrounds = new Set<ColorRole>([
      'surface',
      'surface-raised',
      'surface-sunken',
      'surface-overlay',
      // Behind a sheet, at an opacity; nothing is ever written on it.
      'scrim',
      'border',
      'primary-subtle',
    ]);
    const unmeasured = (Object.keys(colors.light) as ColorRole[]).filter(
      (role) =>
        !backgrounds.has(role) && !CONTRAST_PAIRS.some((p) => p.fg === role || p.bg === role),
    );
    expect(unmeasured).toEqual([]);
  });

  it('defines every role in both themes, as a six-digit hex colour', () => {
    expect(Object.keys(colors.dark).sort()).toEqual(Object.keys(colors.light).sort());
    for (const theme of THEMES) {
      for (const value of Object.values(colors[theme])) expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('names roles by what they are for, never by a palette position', () => {
    for (const role of Object.keys(colors.light)) {
      expect(role).not.toMatch(/\d|gray|grey|red|green|blue|amber|zinc|slate/);
    }
  });

  it('keeps motion inside the application budget: 120–240ms, 300ms for a spatial move', () => {
    const ms = Object.values(duration).map((d) => Number(d.replace('ms', '')));
    expect(Math.min(...ms)).toBeGreaterThanOrEqual(120);
    expect(Math.max(...ms)).toBeLessThanOrEqual(300);
    expect(duration.spatial).toBe('300ms');
  });

  it('never sets body text below 16px, where iOS zooms an input on focus', () => {
    expect(text.base[0]).toBe('1rem');
  });

  it('orders breakpoints and layers from low to high', () => {
    const rem = Object.values(breakpoints).map((b) => Number(b.replace('rem', '')));
    expect(rem).toEqual([...rem].sort((a, b) => a - b));
    const layers = Object.values(zIndex);
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
  });
});
