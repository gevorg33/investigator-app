import { createHash } from 'node:crypto';

/** Crockford's base 32: no I, L, O or U, so an alias read aloud or copied by hand stays the same. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * How an investigator refers to a mission's customer before hire (T-100): a short code, the same for
 * everyone who sees that mission, and derived from the **mission** alone. Nothing about the customer
 * goes in, so two missions of the same customer have unrelated aliases and nothing an investigator
 * holds can link them. It names no one; it only lets "the customer of this mission" be said.
 */
export function customerAliasOf(missionId: string): string {
  const digest = createHash('sha256').update(`customer-alias:${missionId}`).digest();
  let alias = '';
  for (let i = 0; i < 4; i++) alias += ALPHABET[digest[i]! % ALPHABET.length];
  return alias;
}
