import postgres from 'postgres';
import { TEST_POOL_MAX } from './db-budget';

export const TEST_DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

/**
 * The only way a spec opens a database pool (T-069; a static spec enforces it).
 *
 * One place that caps pool size keeps the suite inside its connection budget
 * (`db-budget.ts`), and it is the seam T-073 changes when fixtures and the code under test move
 * onto different roles — one file instead of every spec.
 *
 * A smaller `max` is honoured; a larger one is clamped. A pool must still be at least as large
 * as the transactions a test runs concurrently, plus any query issued outside them while they
 * are open (an audited denial, for example), or the test deadlocks waiting for itself.
 */
export function testPool(opts: { max?: number; role?: 'owner' | 'app' } = {}): postgres.Sql {
  const max = Math.min(opts.max ?? TEST_POOL_MAX, TEST_POOL_MAX);
  // `app` signs in as the runtime role, which is how a spec proves what that role may NOT do.
  const url =
    opts.role === 'app'
      ? TEST_DATABASE_URL.replace(/\/\/[^@]+@/, '//investigator_app:investigator_app@')
      : TEST_DATABASE_URL;
  return postgres(url, { max, onnotice: () => {} });
}
