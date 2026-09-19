import postgres from 'postgres';
import { TEST_POOL_MAX } from './db-budget';

/**
 * The runtime role, `investigator_app`: what the API connects as, so what code under test runs
 * as (T-073). It is not a superuser, has no BYPASSRLS and owns nothing, so row-level security
 * applies to it — which is the only reason a policy test can mean anything.
 */
export const TEST_DATABASE_URL =
  process.env['DATABASE_URL'] ??
  'postgres://investigator_app:investigator_app@localhost:5433/investigator_dev';

/**
 * The owner: what migrations run as, and what fixtures and schema-rule tests use. Fixtures need
 * it because they write what the application may not (taxonomy nodes, rows in several
 * workspaces once T-077 lands); schema tests need it to reach a constraint that a revoked
 * privilege would otherwise refuse first.
 */
export const TEST_OWNER_URL =
  process.env['MIGRATION_DATABASE_URL'] ??
  'postgres://postgres:postgres@localhost:5433/investigator_dev';

/**
 * The only way a spec opens a database pool (T-069; a static spec enforces it).
 *
 * One place that caps pool size keeps the suite inside its connection budget
 * (`db-budget.ts`). `role` picks the connection: `app` (default) for the code under test,
 * `owner` for fixtures and schema rules.
 *
 * A smaller `max` is honoured; a larger one is clamped. A pool must still be at least as large
 * as the transactions a test runs concurrently, plus any query issued outside them while they
 * are open (an audited denial, for example), or the test deadlocks waiting for itself.
 */
export function testPool(opts: { max?: number; role?: 'owner' | 'app' } = {}): postgres.Sql {
  const max = Math.min(opts.max ?? TEST_POOL_MAX, TEST_POOL_MAX);
  const url = opts.role === 'owner' ? TEST_OWNER_URL : TEST_DATABASE_URL;
  return postgres(url, { max, onnotice: () => {} });
}
