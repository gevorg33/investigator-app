import { describe, expect, it } from 'vitest';
import { countryOptions, languageOptions } from './codes';

describe('the language and country pickers’ options', () => {
  it('are every language Intl can name, in the reader’s language, in its order', () => {
    const en = languageOptions('en');
    expect(en).toContainEqual({ code: 'hy', name: 'Armenian' });
    expect(en).toContainEqual({ code: 'ru', name: 'Russian' });
    // Only two-letter codes, and only the ones with a name: "qq" is not a language.
    expect(en.every((o) => /^[a-z]{2}$/.test(o.code))).toBe(true);
    expect(en.map((o) => o.code)).not.toContain('qq');
    const names = en.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(languageOptions('ru')).toContainEqual({ code: 'hy', name: 'армянский' });
  });

  it('are countries, not groupings, pseudo-regions or ones that no longer exist', () => {
    const en = countryOptions('en');
    expect(en).toContainEqual({ code: 'AM', name: 'Armenia' });
    const codes = en.map((o) => o.code);
    for (const notACountry of ['EU', 'UN', 'ZZ', 'XA', 'IC', 'SU', 'YU']) {
      expect(codes).not.toContain(notACountry);
    }
    expect(codes.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    // Every one of ISO's current countries, and not much more (territories Intl also names).
    expect(en.length).toBeGreaterThanOrEqual(249);
    expect(countryOptions('hy')).toContainEqual({ code: 'AM', name: 'Հայաստան' });
  });
});
