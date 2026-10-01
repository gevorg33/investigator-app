/**
 * The name a customer knows an investigator by (T-181): the pseudonym they chose, or "Investigator
 * K7Q2" until they choose one. Never the legal name — the API does not send it to anyone but the
 * investigator themself.
 */
export function investigatorName(
  p: { pseudonym: string | null; nameCode: string },
  unnamed: (code: string) => string,
): string {
  return p.pseudonym ?? unnamed(p.nameCode);
}
