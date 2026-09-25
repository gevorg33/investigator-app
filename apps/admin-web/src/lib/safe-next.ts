/**
 * Where to send a reader after signing in: a path on this site, or home.
 *
 * `next` arrives in a URL anyone can write, so it is an open-redirect vector unless it can only
 * name a page here: it must start with one `/`, and not `//` or `/\` (which a browser reads as
 * another host), and carry no scheme.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\') || /^\/[^/]*:/.test(next)) return '/';
  return next;
}
