/**
 * The pseudonym an investigator is known to customers by (T-181), and what it may not be.
 *
 * The point of a pseudonym is that customers never learn the legal name, so it may share no word
 * with it — not even a first name, since a free-text name does not say which word is which. Nor
 * may it carry a way to be reached off the platform: an email, a web address or a phone number.
 */
export type PseudonymIssue = 'own_name' | 'contact';

/** Spaces inside collapsed and the ends trimmed, so "North  Star " and "North Star" are one name. */
export function normalisePseudonym(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** The words of a name worth comparing: letters only, three or more, without case. */
const words = (name: string): string[] =>
  name
    .toLocaleLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3);

export function pseudonymIssue(pseudonym: string, legalName: string | null): PseudonymIssue | null {
  // An address, a domain or six digits anywhere (a phone, however it is spaced).
  if (/@|\b[\p{L}\d-]+\.[a-z]{2,}\b/iu.test(pseudonym)) return 'contact';
  if ((pseudonym.match(/\d/g) ?? []).length >= 6) return 'contact';
  if (legalName !== null) {
    const own = new Set(words(legalName));
    if (words(pseudonym).some((w) => own.has(w))) return 'own_name';
  }
  return null;
}
