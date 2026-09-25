import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isLocale, LOCALES, localeName, resolveLocale } from './locales.js';

describe('locales', () => {
  it('launches with English, Russian and Armenian, English the default', () => {
    expect(LOCALES).toEqual(['en', 'ru', 'hy']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect([isLocale('ru'), isLocale('de'), isLocale(undefined), isLocale(3)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('names each locale in its own language, capitalised as a menu item', () => {
    expect(LOCALES.map(localeName)).toEqual(['English', 'Русский', 'Հայերեն']);
  });

  describe('resolving the reader’s locale', () => {
    it('takes the reader’s own choice over their browser', () => {
      expect(resolveLocale({ choice: 'hy', acceptLanguage: 'ru-RU,ru;q=0.9' })).toEqual({
        locale: 'hy',
        source: 'choice',
      });
    });

    it.each([
      ['ru-RU,ru;q=0.9,en-US;q=0.8', 'ru'],
      ['de-DE,de;q=0.9,hy;q=0.5,ru;q=0.4', 'hy'],
      // Weight decides, not position.
      ['en;q=0.3, ru;q=0.8', 'ru'],
      // Equal weight: the header's own order.
      ['hy, ru', 'hy'],
      ['HY-am', 'hy'],
    ])('follows the browser: %s → %s', (acceptLanguage, locale) => {
      expect(resolveLocale({ acceptLanguage })).toEqual({ locale, source: 'browser' });
    });

    it.each([
      [{}],
      [{ choice: 'de', acceptLanguage: 'de-DE,fr;q=0.5' }],
      // A language refused outright (q=0) is not a request for it; nonsense is ignored.
      [{ acceptLanguage: 'ru;q=0, hy;q=abc, ;;;' }],
      [{ acceptLanguage: null }],
    ])('falls back to English, and says so: %j', (input) => {
      expect(resolveLocale(input)).toEqual({ locale: 'en', source: 'default' });
    });
  });
});
