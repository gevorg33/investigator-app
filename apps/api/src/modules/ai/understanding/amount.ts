/**
 * An amount of money, with its currency (T-220, P-9; AI-EXECUTION-PLAN §4 "normalize"): integer minor
 * units and an ISO 4217 code, the platform's shape for money (`formatMoney` divides by the same
 * minor-unit digits). A deterministic slot over English, Russian and Armenian phrasings.
 *
 * Never guesses the currency: a number with none is a question. Nor which of two currencies was
 * meant, nor what "1.500" means where "." could separate thousands — a dot is the decimal point
 * unless the number has two or more dot-separated groups of three.
 */

export type Amount =
  | { kind: 'amount'; minor: number; currency: string }
  | { kind: 'question'; reason: 'currency_unknown' | 'not_understood' };

/** Each currency the platform deals in, and how people write it. */
const CURRENCIES: ReadonlyArray<[string, RegExp]> = [
  ['USD', /\$|\busd\b|\bdollars?\b|доллар\p{L}*|дол\.|դոլար\p{L}*/iu],
  ['EUR', /€|\beur\b|\beuros?\b|евро|եվրո\p{L}*/iu],
  ['RUB', /₽|\brub\b|\brub(?:le|les)\b|\broubles?\b|рубл\p{L}*|руб\.?|ռուբլի\p{L}*/iu],
  ['AMD', /֏|\bamd\b|\bdrams?\b|драм\p{L}*|դրամ\p{L}*/iu],
  ['GBP', /£|\bgbp\b|\bpounds?\b|фунт\p{L}*|ֆունտ\p{L}*/iu],
];

/** Words that multiply what comes before them. */
const SCALES: ReadonlyArray<[RegExp, number]> = [
  [/^(k|thousand|тыс\.?|тысяч\p{L}*|հազար)$/iu, 1_000],
  [/^(m|mln|million|млн\.?|миллион\p{L}*|միլիոն)$/iu, 1_000_000],
];

/** The digits after the point a currency has (the same reading as `formatMoney`). */
const minorDigits = (currency: string): number =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits!;

/** A written number as a decimal string, or null when its separators cannot be read one way only. */
function decimal(written: string): string | null {
  const s = written.replace(/[\s\u00A0\u202F']/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both: the later one is the decimal point, the other separates thousands.
    const point = lastComma > lastDot ? ',' : '.';
    const thousands = point === ',' ? '.' : ',';
    return s.split(thousands).join('').replace(point, '.');
  }
  if (lastComma >= 0) {
    // "1,500" and "1,500,000" are thousands; "20,50" is a decimal comma.
    if (/^\d{1,3}(,\d{3})+$/.test(s)) return s.replace(/,/g, '');
    return /^\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : null;
  }
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) return s.replace(/\./g, '');
  return /^\d+(\.\d+)?$/.test(s) ? s : null;
}

/** Reads the amount `text` names. */
export function parseAmount(text: string): Amount {
  const t = text.normalize('NFC');
  const number = t.match(/\d[\d\s\u00A0\u202F,.']*/u);
  if (number === null) return { kind: 'question', reason: 'not_understood' };
  const written = number[0].replace(/[\s,.']+$/u, '');
  const value = decimal(written);
  if (value === null) return { kind: 'question', reason: 'not_understood' };

  const after = t
    .slice(number.index! + number[0].length)
    .trim()
    .split(/\s+/)[0]!;
  const scale = SCALES.find(([re]) => re.test(after))?.[1] ?? 1;

  const named = CURRENCIES.filter(([, re]) => re.test(t)).map(([code]) => code);
  if (named.length === 0) return { kind: 'question', reason: 'currency_unknown' };
  if (named.length > 1) return { kind: 'question', reason: 'not_understood' };
  const currency = named[0]!;

  const digits = minorDigits(currency);
  const [whole, fraction = ''] = value.split('.');
  // Exact, in integers: no floating point between what was written and what is stored.
  const scaled = BigInt(whole! + fraction) * BigInt(scale);
  const shift = digits - fraction.length;
  if (shift < 0 && scaled % 10n ** BigInt(-shift) !== 0n) {
    // More decimals than the currency has: "$1.005" is not an amount anyone can pay.
    return { kind: 'question', reason: 'not_understood' };
  }
  const minor = shift >= 0 ? scaled * 10n ** BigInt(shift) : scaled / 10n ** BigInt(-shift);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    return { kind: 'question', reason: 'not_understood' };
  return { kind: 'amount', minor: Number(minor), currency };
}
