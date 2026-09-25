/**
 * The workspace the page in this tab was rendered in (T-092), which every browser call names as
 * `X-Workspace`. Without it a call would fall back to the session's default workspace — which
 * another tab may have just switched — and a form on this page could write into a workspace the
 * page is not showing. The API intersects the header with the reader's memberships, so it can only
 * ever choose among workspaces the reader already has (ADR-0011): it is a choice, not authority.
 *
 * Set by `WorkspaceScope` while it renders, in the browser only: on the server this module is
 * shared by every request, and server calls use the session's default instead.
 */
let pinned: string | null = null;

export function pinWorkspace(id: string | null): void {
  if (typeof window !== 'undefined') pinned = id;
}

export function workspaceHeader(): Record<string, string> {
  return pinned === null ? {} : { 'x-workspace': pinned };
}
