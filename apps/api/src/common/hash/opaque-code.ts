import { createHash } from 'node:crypto';

/** Crockford's base 32: no I, L, O or U, so a code read aloud or copied by hand stays the same. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A four-character code that stands for one thing without saying anything about it: a mission's
 * customer before hire (T-100), an investigator who has not chosen a name yet (T-181). It is a hash
 * of the namespace and that thing's own id alone, so nothing else can be read from it or linked
 * through it, and the namespace keeps one kind of code from ever equalling another for the same id.
 */
export function opaqueCode(namespace: string, id: string): string {
  const digest = createHash('sha256').update(`${namespace}:${id}`).digest();
  let code = '';
  for (let i = 0; i < 4; i++) code += ALPHABET[digest[i]! % ALPHABET.length];
  return code;
}
