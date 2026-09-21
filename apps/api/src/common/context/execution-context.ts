import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who is acting, and in which workspace (ADR-0011, docs/architecture/tenancy.md §6).
 *
 * Established once, at the request or job boundary, from trusted state — never from a body, a
 * query string, a path segment, model output or a tool argument. Frozen, so nothing downstream
 * can edit it; and never a function parameter, so no service, repository or command has a
 * `tenantId` argument a caller could get wrong. The database reads it through the scoped client
 * (`database/scoped-client.ts`) and PostgreSQL enforces it (T-077).
 */
export interface ExecutionContext {
  readonly tenantId: string;
  readonly tenantKind: 'PERSONAL' | 'AGENCY';
  readonly userId: string;
  readonly membershipId: string;
  /** The session this request arrived on, so an audit row can say which one did it (T-080). */
  readonly sessionId: string;
  /** Tenant permissions held in this workspace, read with the membership on this request. */
  readonly permissions: readonly string[];
}

const storage = new AsyncLocalStorage<ExecutionContext>();
const userOnly = new AsyncLocalStorage<string>();

/** The context the current code is running in, or undefined outside any (sign-in, bootstrap). */
export function currentContext(): ExecutionContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` — and everything it awaits — inside `context`. The only way a context is entered: the
 * request interceptor calls it around a handler, and a job worker (T-082) around a job.
 */
export function runInContext<T>(context: ExecutionContext, fn: () => T): T {
  return userOnly.exit(() => storage.run(freeze(context), fn));
}

/**
 * Runs `fn` as `userId` with no workspace — the pre-workspace context (T-077). The database then
 * shows the user their own memberships, the workspaces they belong to and their role
 * assignments, and nothing scoped to any workspace. It exists for exactly the reads that choose a
 * workspace: the resolver, and the Personal workspace a new session opens in. Inside a request it
 * narrows, never widens — the workspace is set aside for `fn` and comes back afterwards — so a
 * pre-workspace read is the same read wherever it is made from.
 */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return storage.exit(() => userOnly.run(userId, fn));
}

/** The user of the pre-workspace context, when the current code runs in one. */
export function currentUserOnly(): string | undefined {
  return userOnly.getStore();
}

/** Frozen all the way down, the permission list included. */
export function freeze(context: ExecutionContext): ExecutionContext {
  return Object.freeze({ ...context, permissions: Object.freeze([...context.permissions]) });
}
