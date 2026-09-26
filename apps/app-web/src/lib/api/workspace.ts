/**
 * The workspace the page in this tab was rendered in (T-092), which every browser call names as
 * `X-Workspace`, and the role the reader chose to act as there (T-145), named as `X-Active-Role`.
 *
 * The workspace: Without it a call would fall back to the session's default workspace — which
 * another tab may have just switched — and a form on this page could write into a workspace the
 * page is not showing. The API intersects the header with the reader's memberships, so it can only
 * ever choose among workspaces the reader already has (ADR-0011): it is a choice, not authority.
 *
 * Set by `WorkspaceScope` while it renders, in the browser only: on the server this module is
 * shared by every request, and server calls use the session's default instead.
 */
let pinned: string | null = null;
/**
 * The role: server reads forward the `active_role` cookie themselves (`server.ts`). The cookie is
 * httpOnly, so the browser cannot read it, and is told it instead. Without it a person with both
 * roles who chose to act as a customer was their full self for every call from the browser. The
 * API only ever narrows by it.
 */
let role: string | null = null;

export function pinWorkspace(id: string | null): void {
  if (typeof window !== 'undefined') pinned = id;
}

export function pinRole(chosen: string | null): void {
  if (typeof window !== 'undefined') role = chosen;
}

/** The headers every browser call carries: where the page is, and as whom the reader acts. */
export function scopeHeaders(): Record<string, string> {
  return {
    ...(pinned === null ? {} : { 'x-workspace': pinned }),
    ...(role === null ? {} : { 'x-active-role': role }),
  };
}
