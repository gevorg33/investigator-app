import type postgres from 'postgres';
import { currentContext, type ExecutionContext } from '../common/context/execution-context';

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
 * Outside any context (sign-in, token redemption, bootstrap) a query passes through untouched.
 * Once RLS is on, such a query can read the identity tables and nothing scoped to a workspace:
 * failing closed is the database's job, not this wrapper's.
 */
const SET_CONTEXT = `SELECT set_config('app.tenant_id', $1, true),
       set_config('app.user_id', $2, true),
       set_config('app.membership_id', $3, true)`;

export async function applyContext(
  tx: postgres.TransactionSql,
  context: ExecutionContext,
): Promise<void> {
  await tx.unsafe(SET_CONTEXT, [context.tenantId, context.userId, context.membershipId]);
}

type Begin = postgres.Sql['begin'];
type Unsafe = postgres.Sql['unsafe'];

export function scopedClient(base: postgres.Sql): postgres.Sql {
  const begin = ((...args: unknown[]) => {
    const context = currentContext();
    const callback = args[args.length - 1] as (tx: postgres.TransactionSql) => unknown;
    const wrapped = async (tx: postgres.TransactionSql) => {
      if (context !== undefined) await applyContext(tx, context);
      return callback(tx);
    };
    const options = args.length > 1 ? (args[0] as string) : undefined;
    return options === undefined ? base.begin(wrapped) : base.begin(options, wrapped);
  }) as Begin;

  const unsafe = ((query: string, params?: unknown[], options?: unknown) => {
    const context = currentContext();
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
