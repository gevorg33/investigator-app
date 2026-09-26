import { catalogs, type Locale } from '@investigator/i18n';

/**
 * The words on screen, from the same catalog the app renders (T-128) — so a copy change moves
 * the app and the suite together, and a selector can never pass on a string no reader sees.
 * Placeholders are substituted plainly; no message the suite reads needs a plural.
 */
export function text(key: string, values: Record<string, string> = {}, locale: Locale = 'en') {
  let node: unknown = catalogs[locale];
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== 'string') throw new Error(`no message ${key} in ${locale}`);
  return node.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`${key} needs {${name}}`);
    return value;
  });
}
