import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { runInContext, type ExecutionContext } from '../src/common/context/execution-context';
import * as schema from '../src/database/schema';
import { scopedClient } from '../src/database/scoped-client';
import { member } from './workspace-fixtures';

/**
 * Running a service in a spec the way a request runs it (T-077).
 *
 * With row-level security on, a query outside any workspace context sees nothing. Production
 * never makes one: `ActorGuard` resolves the workspace and `ContextInterceptor` runs the handler
 * inside it. A spec that called a service directly would be testing something that cannot happen,
 * and would fail for a reason the application does not have.
 *
 * So a spec builds its database client with `scopedDb` — the same wrapper the DB provider uses —
 * and wraps the service in `asRequests`, which enters the caller's Personal workspace, exactly as
 * the resolver would for a session with no workspace chosen. Cross-workspace behaviour is proved
 * in `src/database/rls.spec.ts` and in each service's own isolation cases, not by the absence of
 * a context.
 */
export function scopedDb(sql: postgres.Sql): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(scopedClient(sql), { schema });
}

/**
 * The Personal workspace of `userId`, read as the owner — the fixture's view, not the app's.
 *
 * An actor the authorization harness invented has no user row and so no workspace. It gets a real
 * but empty one — real, because a row written there still has to satisfy its foreign keys; empty,
 * because the check such an actor exists to exercise must refuse it before it reads anything.
 */
export async function personalContext(
  owner: postgres.Sql,
  userId: string,
): Promise<ExecutionContext> {
  const [row] = await owner<{ tenant: string; membership: string }[]>`
    SELECT t.id AS tenant, m.id AS membership
      FROM tenants t
      JOIN tenant_memberships m ON m.tenant_id = t.id AND m.user_id = t.personal_owner_id
     WHERE t.personal_owner_id = ${userId}`;
  if (row === undefined) return { ...(await nowhere(owner)), userId };
  return {
    tenantId: row.tenant,
    tenantKind: 'PERSONAL',
    userId,
    membershipId: row.membership,
    permissions: await permissionsOf(owner, row.membership),
  };
}

/**
 * What the membership's roles grant, read from the catalog — the same query the resolver makes
 * (T-078). A context with an empty permission list would refuse everything the way no other
 * caller does, so a spec would be testing the harness rather than the service.
 */
async function permissionsOf(owner: postgres.Sql, membershipId: string): Promise<string[]> {
  const rows = await owner<{ key: string }[]>`
    SELECT DISTINCT rp.permission_key AS key
      FROM membership_roles mr
      JOIN role_permissions rp ON rp.role_id = mr.role_id
     WHERE mr.membership_id = ${membershipId}
     ORDER BY 1`;
  return rows.map((r) => r.key);
}

/**
 * One empty workspace per pool, for actors the harness invented rather than registered.
 *
 * Personal, like the workspace such a caller would really be in: a customer's action is refused
 * outside a Personal workspace (T-078), and an invented actor exists to exercise the check after
 * that one, not this one. It is empty, so it still shows them nothing.
 */
const empties = new Map<postgres.Sql, Promise<ExecutionContext>>();

async function nowhere(owner: postgres.Sql): Promise<ExecutionContext> {
  let pending = empties.get(owner);
  if (pending === undefined) {
    pending = (async () => {
      const { actor, personalId } = await member(owner);
      const [row] = await owner<{ id: string }[]>`
        SELECT id FROM tenant_memberships WHERE tenant_id = ${personalId}`;
      return {
        tenantId: personalId,
        tenantKind: 'PERSONAL' as const,
        userId: actor.userId,
        membershipId: row!.id,
        permissions: await permissionsOf(owner, row!.id),
      };
    })();
    empties.set(owner, pending);
  }
  return pending;
}

/** Runs `fn` in `userId`'s Personal workspace — for a call that takes no actor to enter it by. */
export async function inWorkspaceOf<T>(
  owner: postgres.Sql,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runInContext(await personalContext(owner, userId), fn);
}

/**
 * The service, entered as a request would enter it: every call whose first argument is an actor
 * runs in that actor's Personal workspace. Calls without an actor — the system paths — pass
 * through untouched, since production has no context for those either.
 */
export function asRequests<T extends object>(service: T, owner: postgres.Sql): T {
  const contexts = new Map<string, Promise<ExecutionContext>>();
  return new Proxy(service, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const method = value as (...args: unknown[]) => unknown;
      return async (...args: unknown[]): Promise<unknown> => {
        const userId = (args[0] as { userId?: unknown } | undefined)?.userId;
        if (typeof userId !== 'string') return method.apply(target, args);
        let context = contexts.get(userId);
        if (context === undefined) {
          context = personalContext(owner, userId);
          contexts.set(userId, context);
        }
        return runInContext(await context, async () => method.apply(target, args));
      };
    },
  });
}
