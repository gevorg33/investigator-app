/**
 * A full page load, not a client-side transition: after signing in or out the server must render
 * with the new cookie. One function so a test can see where a flow was sent.
 */
export function navigate(url: string): void {
  window.location.assign(url);
}
