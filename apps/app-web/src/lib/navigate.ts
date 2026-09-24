/**
 * A full page load, not a client-side transition: after signing in or out the server must render
 * with the new cookies, and `/session/start` is a route handler, not a page. One function so a
 * test can see where a flow was sent.
 */
export function navigate(url: string): void {
  window.location.assign(url);
}

/** Drops the query from the address bar, so a one-time token is not kept in history. */
export function forgetQuery(): void {
  window.history.replaceState(null, '', window.location.pathname);
}

/** The device's IANA time zone, when it has a usable one — sent at sign-up (T-127). */
export function deviceTimeZone(): string | undefined {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === 'string' && /^[A-Za-z]/.test(zone) ? zone : undefined;
}
