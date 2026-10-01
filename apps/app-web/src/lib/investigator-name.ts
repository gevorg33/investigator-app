/**
 * The name a customer knows an investigator by (T-181, T-182): the one they chose — their pseudonym,
 * the default, or their legal name if they opted for it — or "Investigator K7Q2" until it is set.
 * Which one is the API's to decide: it sends the legal name only when the investigator chose it.
 */
export function investigatorName(
  p: { name: string | null; nameCode: string },
  unnamed: (code: string) => string,
): string {
  return p.name ?? unnamed(p.nameCode);
}
