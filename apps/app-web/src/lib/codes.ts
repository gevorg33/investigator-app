/**
 * The two-letter language (ISO 639-1) and country (ISO 3166-1) codes a picker offers, and their
 * names in the reader's language — asked of `Intl.DisplayNames`, not kept as a list here, so there
 * is nothing to go stale and no reference data in the codebase (T-123).
 *
 * A code counts when `Intl` can name it: every two-letter combination is asked, and the ones it
 * has no name for are left out. A handful of region codes name groupings rather than countries, and
 * are left out too.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Region codes `Intl` names that are not countries a person works in: groupings (EU, UN),
 * pseudo-regions (XA, XB, ZZ), ISO's exceptionally reserved codes (AC, CP, DG, EA, IC, TA) and
 * retired ones (AN, BU, CS, DD, FX, NT, SU, TP, YD, YU, ZR).
 */
const NOT_COUNTRIES = new Set([
  ...['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ'],
  ...['AC', 'CP', 'DG', 'EA', 'IC', 'TA'],
  ...['AN', 'BU', 'CS', 'DD', 'FX', 'NT', 'SU', 'TP', 'YD', 'YU', 'ZR'],
]);

const pairs = (): string[] => [...LETTERS].flatMap((a) => [...LETTERS].map((b) => a + b));

export interface CodeOption {
  code: string;
  name: string;
}

function options(locale: string, type: 'language' | 'region', codes: string[]): CodeOption[] {
  const names = new Intl.DisplayNames([locale], { type, fallback: 'none' });
  return codes
    .flatMap((code) => {
      const name = names.of(code);
      return name === undefined ? [] : [{ code, name }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Languages by ISO 639-1 code, named and sorted in `locale`. */
export function languageOptions(locale: string): CodeOption[] {
  return options(locale, 'language', pairs());
}

/** Countries by ISO 3166-1 alpha-2 code, named and sorted in `locale`. */
export function countryOptions(locale: string): CodeOption[] {
  return options(
    locale,
    'region',
    pairs()
      .map((p) => p.toUpperCase())
      .filter((code) => !NOT_COUNTRIES.has(code)),
  );
}
