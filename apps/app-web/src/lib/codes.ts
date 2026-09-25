/**
 * The two-letter language (ISO 639-1) and country (ISO 3166-1) codes a picker offers, and their
 * names in the reader's language — asked of `Intl.DisplayNames`, not kept as a list here, so there
 * is nothing to go stale and no reference data in the codebase (T-123).
 *
 * A code counts when `Intl` can name it and it is its own current form: every two-letter
 * combination is asked, and the ones it has no name for are left out, as are retired aliases —
 * `Intl` names DY "Benin" and iw "Hebrew", and `getCanonicalLocales` says they are now BJ and he
 * (T-092). A handful of region codes name groupings rather than countries, and are left out too.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Region codes `Intl` names, in their current form, that are not countries a person works in:
 * groupings (EU, UN), pseudo-regions (XA, XB, ZZ) and ISO's exceptionally reserved codes (AC, CP,
 * DG, EA, IC, TA). Retired codes need no list: each canonicalises to its successor.
 */
const NOT_COUNTRIES = new Set([
  ...['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'],
  ...['AC', 'CP', 'DG', 'EA', 'IC', 'TA'],
]);

/** Whether a code is current rather than a retired alias of another: `und-DY` becomes `und-BJ`. */
const current = (tag: string) => Intl.getCanonicalLocales(tag)[0] === tag;

const pairs = (): string[] => [...LETTERS].flatMap((a) => [...LETTERS].map((b) => a + b));

export interface CodeOption {
  code: string;
  name: string;
}

function options(locale: string, type: 'language' | 'region', codes: string[]): CodeOption[] {
  const names = new Intl.DisplayNames([locale], { type, fallback: 'none' });
  // One entry per name: a picker offering two identical choices helps no one. Codes are asked in
  // order, so the first wins — `ak` for Akan rather than `tw`, which Intl also names Akan.
  const seen = new Set<string>();
  return codes
    .flatMap((code) => {
      const name = names.of(code);
      if (name === undefined || seen.has(name)) return [];
      seen.add(name);
      return [{ code, name }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Languages by ISO 639-1 code, named and sorted in `locale`. */
export function languageOptions(locale: string): CodeOption[] {
  return options(locale, 'language', pairs().filter(current));
}

/** Countries by ISO 3166-1 alpha-2 code, named and sorted in `locale`. */
export function countryOptions(locale: string): CodeOption[] {
  return options(
    locale,
    'region',
    pairs()
      .map((p) => p.toUpperCase())
      .filter((code) => !NOT_COUNTRIES.has(code) && current(`und-${code}`)),
  );
}
