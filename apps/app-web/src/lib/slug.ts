/**
 * An id for a heading, the same wherever it is made — the help page's section and a citation's
 * link to it (T-059). Letters and digits of any script, so Armenian and Russian headings keep theirs.
 */
export function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
