import { catalogs, LOCALES } from '@investigator/i18n';
import { describe, expect, it } from 'vitest';
import { DESTINATIONS, isCurrent } from './destinations';

describe('primary destinations', () => {
  it('keeps to three to five, each with its own place and a label in every language', () => {
    expect(DESTINATIONS.length).toBeGreaterThanOrEqual(3);
    expect(DESTINATIONS.length).toBeLessThanOrEqual(5);
    expect(new Set(DESTINATIONS.map((d) => d.href)).size).toBe(DESTINATIONS.length);
    for (const locale of LOCALES) {
      for (const d of DESTINATIONS) expect(catalogs[locale].nav[d.label]).not.toBe('');
    }
  });

  it.each([
    ['/', '/', true],
    ['/missions', '/', false],
    ['/missions', '/missions', true],
    ['/missions/42/quotes', '/missions', true],
    // A sibling that merely starts with the same letters is somewhere else.
    ['/missionsarchive', '/missions', false],
    ['/', '/missions', false],
  ])('at %s, %s is current: %s', (pathname, href, expected) => {
    expect(isCurrent(pathname, href)).toBe(expected);
  });
});
