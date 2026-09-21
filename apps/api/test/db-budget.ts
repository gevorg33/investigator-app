/**
 * The test suite's database connection budget, in one place (T-069).
 *
 * Imported by `vitest.config.mts` and asserted by `connection-budget.spec.ts`, so the numbers
 * that bound concurrency cannot drift away from the numbers that were checked.
 *
 * Worst case = MAX_WORKERS × PER_FILE_BUDGET, and it must fit inside the server's
 * `max_connections`, less its reserved slots and headroom for anything else connected. The
 * per-file budget already allows for two helper pools (T-073 splits fixtures and code under
 * test onto separate roles) plus one full application pool for specs that boot the app.
 */

/** Fixed, not derived from the machine — CI's runner has 4 vCPUs, and a flake must reproduce locally. */
export const MAX_WORKERS = 4;

/** The cap on any pool a spec opens through `testPool()`. Every concurrency test fans out two transactions. */
export const TEST_POOL_MAX = 4;

/**
 * Connections one spec file may hold at once: app pool (10) + two helper pools (4 + 4), plus
 * the one `setup-database.ts` holds for the whole file to empty the database before it (T-042).
 */
export const PER_FILE_BUDGET = 19;

/** Left free for psql, the dev server, and whatever else is connected while tests run. */
export const HEADROOM = 20;
