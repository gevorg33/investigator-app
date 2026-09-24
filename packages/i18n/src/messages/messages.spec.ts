import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { LOCALES, type Locale } from '../locales.js';
import { catalogs, en } from './index.js';

type Tree = { readonly [key: string]: string | Tree };

/** `{ nav: { home: 'Home' } }` → `{ 'nav.home': 'Home' }`. */
function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}

// intl-messageformat AST element types (from @formatjs/icu-messageformat-parser).
const ARGUMENT_TYPES = new Set([1, 2, 3, 4, 5, 6]); // argument, number, date, time, select, plural
const PLURAL = 6;
type Element = {
  type: number;
  value?: unknown;
  options?: Record<string, { value: Element[] }>;
  children?: Element[];
  pluralType?: string;
};

/**
 * What is wrong with one locale's catalog against the English source — empty when nothing is.
 * Keys (a backstop: the types already refuse a missing or extra key), ICU validity, the same
 * arguments as English, and every plural category the locale's grammar has.
 */
function problems(source: Tree, target: Tree, locale: Locale): string[] {
  const src = flatten(source);
  const tgt = flatten(target);
  const found: string[] = [];
  for (const key of Object.keys(src)) if (!(key in tgt)) found.push(`${key}: missing`);
  for (const key of Object.keys(tgt)) if (!(key in src)) found.push(`${key}: not in the source`);
  const walk = (els: Element[], args: Set<string>, key: string, lang: Locale) => {
    const categories = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
    for (const el of els) {
      if (ARGUMENT_TYPES.has(el.type)) args.add(String(el.value));
      if (el.type === PLURAL && el.pluralType === 'cardinal') {
        const missing = categories.filter((c) => !(c in el.options!));
        if (missing.length > 0) found.push(`${key}: plural lacks ${missing.join(', ')}`);
      }
      for (const option of Object.values(el.options ?? {})) walk(option.value, args, key, lang);
      walk(el.children ?? [], args, key, lang);
    }
  };
  const argumentsOf = (message: string, lang: Locale, key: string): Set<string> | null => {
    try {
      const args = new Set<string>();
      walk(new IntlMessageFormat(message, lang).getAst() as Element[], args, key, lang);
      return args;
    } catch (e) {
      found.push(`${key}: not valid ICU (${(e as Error).message.split('\n')[0]})`);
      return null;
    }
  };
  for (const [key, message] of Object.entries(tgt)) {
    if (!(key in src)) continue;
    if (message.trim() === '') found.push(`${key}: empty`);
    const want = argumentsOf(src[key]!, 'en', `en:${key}`);
    const have = argumentsOf(message, locale, key);
    if (want !== null && have !== null && [...want].sort().join() !== [...have].sort().join()) {
      found.push(
        `${key}: arguments {${[...have].join(', ')}}, English has {${[...want].join(', ')}}`,
      );
    }
  }
  return found;
}

describe('translation catalogs', () => {
  it.each(LOCALES)(
    '%s has every English key, valid ICU, the same arguments and full plurals',
    (locale) => {
      expect(problems(en, catalogs[locale], locale)).toEqual([]);
    },
  );

  it('keeps the source catalog English, and the others translated rather than copied', () => {
    expect(catalogs.en).toBe(en);
    const english = flatten(en);
    for (const locale of ['ru', 'hy'] as const) {
      const copied = Object.entries(flatten(catalogs[locale])).filter(
        // The product name is a name, the same in every language.
        ([key, value]) => key !== 'app.name' && value === english[key],
      );
      expect(copied).toEqual([]);
    }
  });

  describe('the checker itself — each fault it exists to catch', () => {
    const source = {
      a: { b: 'Hello {name}' },
      n: '{count, plural, one {# quote} other {# quotes}}',
    };

    it.each([
      ['a missing key', { a: {}, n: source.n }, 'en', 'a.b: missing'],
      ['an extra key', { ...source, z: 'x' }, 'en', 'z: not in the source'],
      ['broken ICU', { a: { b: 'Hi {name' }, n: source.n }, 'en', 'a.b: not valid ICU'],
      [
        'a lost argument',
        { a: { b: 'Hello' }, n: source.n },
        'en',
        'a.b: arguments {}, English has {name}',
      ],
      ['an empty string', { a: { b: '' }, n: source.n }, 'en', 'a.b: empty'],
      [
        'Russian plurals written the English way',
        { a: source.a, n: '{count, plural, one {# предложение} other {# предложений}}' },
        'ru',
        'n: plural lacks few, many',
      ],
    ] as const)('finds %s', (_label, target, locale, expected) => {
      expect(problems(source, target as Tree, locale).join('\n')).toContain(expected);
    });

    it('finds a broken plural nested inside a select, and passes a complete one', () => {
      const nested = {
        m: '{role, select, customer {{count, plural, one {# a} other {# b}}} other {x}}',
      };
      expect(problems(nested, nested, 'ru')).toEqual(['m: plural lacks few, many']);
      const tags = { t: 'Read <b>{title}</b>' };
      expect(problems(tags, tags, 'en')).toEqual([]);
      expect(problems(source, source, 'en')).toEqual([]);
    });
  });
});
