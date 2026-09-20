import type postgres from 'postgres';
import { currentContext, currentUserOnly } from '../common/context/execution-context';
import { currentPlatformAccess } from '../common/context/platform-context';

/**
 * The execution context, carried into every query (T-075, ADR-0011 §4).
 *
 * Drizzle talks to postgres.js through three calls: `unsafe()` for a bare query (awaited, or
 * `.values()` for array rows), `begin()` for a transaction, and `savepoint()` inside one. This
 * wraps the first two. When the code is running in an execution context:
 *
 * - `begin(cb)` sets the context as the first statement of the transaction, then runs `cb`.
 * - a bare query runs as its own short transaction: `BEGIN; set_config(…); <query>; COMMIT`.
 *
 * Always `set_config(…, true)` — transaction-local — so nothing survives on a pooled connection
 * once the transaction ends. The settings read back as an empty string afterwards, which is why
 * the policies (T-077) read them through `NULLIF(…, '')`: no context means no rows.
 *
 * Deliberately NOT one transaction per request: it would hold a connection across external calls,
 * and roll back AuthzService's denial audit row whenever the request failed.
 *
 * Three things set it (T-077), combined by `databaseSettings()`:
 *
 * - the execution context: the workspace, the user and the membership;
 * - the pre-workspace context (`runAsUser`): the user alone, and it drops any workspace;
 * - `PlatformContext`: `app.platform_access`, on top of whatever else is set. This file writes
 *   the setting; only `platform-context.ts` can make it 'on'.
 *
 * Outside all three (sign-in, token redemption, bootstrap) a query passes through untouched, and
 * row-level security shows it the identity tables and nothing scoped to a workspace: failing
 * closed is the database's job, not this wrapper's.
 */
const SET_CONTEXT = `SELECT set_config('app.tenant_id', $1, true),
       set_config('app.user_id', $2, true),
       set_config('app.membership_id', $3, true),
       set_config('app.platform_access', $4, true)`;

export interface DatabaseSettings {
  readonly tenantId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly platformAccess: 'on' | '';
}

/** What the database is told about the current code, or undefined when it runs in no context. */
export function databaseSettings(): DatabaseSettings | undefined {
  const context = currentContext();
  const user = currentUserOnly();
  const platform = currentPlatformAccess();
  if (context === undefined && user === undefined && platform === undefined) return undefined;
  // A pre-workspace context sets aside the workspace one (`runAsUser`), so the two never both
  // apply: the user is whichever of them is here.
  return {
    tenantId: context?.tenantId ?? '',
    userId: user ?? context?.userId ?? '',
    membershipId: context?.membershipId ?? '',
    platformAccess: platform === undefined ? '' : 'on',
  };
}

export async function applyContext(
  tx: postgres.TransactionSql,
  settings: DatabaseSettings,
): Promise<void> {
  await tx.unsafe(SET_CONTEXT, [
    settings.tenantId,
    settings.userId,
    settings.membershipId,
    settings.platformAccess,
  ]);
}

type Begin = postgres.Sql['begin'];
type Unsafe = postgres.Sql['unsafe'];

export function scopedClient(base: postgres.Sql): postgres.Sql {
  const begin = ((...args: unknown[]) => {
    const context = databaseSettings();
    const callback = args[args.length - 1] as (tx: postgres.TransactionSql) => unknown;
    const wrapped = async (tx: postgres.TransactionSql) => {
      if (context !== undefined) await applyContext(tx, context);
      return callback(tx);
    };
    const options = args.length > 1 ? (args[0] as string) : undefined;
    return options === undefined ? base.begin(wrapped) : base.begin(options, wrapped);
  }) as Begin;

  const unsafe = ((query: string, params?: unknown[], options?: unknown) => {
    const context = databaseSettings();
    if (context === undefined) {
      return base.unsafe(query, params as never, options as never);
    }
    // Drizzle either awaits the query or calls `.values()` on it — never both — so each mode
    // starts its own transaction once, on first use.
    const runs = new Map<boolean, Promise<unknown>>();
    const run = (values: boolean): Promise<unknown> => {
      let pending = runs.get(values);
      if (pending === undefined) {
        pending = base.begin(async (tx) => {
          await applyContext(tx, context);
          const q = tx.unsafe(query, params as never, options as never);
          return values ? q.values() : q;
        });
        runs.set(values, pending);
      }
      return pending;
    };
    return {
      then: (onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        run(false).then(onFulfilled, onRejected),
      catch: (onRejected: (e: unknown) => unknown) => run(false).catch(onRejected),
      values: () => run(true),
    };
  }) as unknown as Unsafe;

  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === 'begin') return begin;
      if (property === 'unsafe') return unsafe;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}
