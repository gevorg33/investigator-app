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
  /** Tenant permissions held in this workspace, read with the membership on this request. */
  readonly permissions: readonly string[];
}

const storage = new AsyncLocalStorage<ExecutionContext>();

/** The context the current code is running in, or undefined outside any (sign-in, bootstrap). */
export function currentContext(): ExecutionContext | undefined {
  return storage.getStore();
}

/**
 * Runs `fn` — and everything it awaits — inside `context`. The only way a context is entered: the
 * request interceptor calls it around a handler, and a job worker (T-082) around a job.
 */
export function runInContext<T>(context: ExecutionContext, fn: () => T): T {
  return storage.run(freeze(context), fn);
}

/** Frozen all the way down, the permission list included. */
export function freeze(context: ExecutionContext): ExecutionContext {
  return Object.freeze({ ...context, permissions: Object.freeze([...context.permissions]) });
}
