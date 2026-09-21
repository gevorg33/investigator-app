import { MAX_WORKERS } from './db-budget';

/**
 * The local defaults, in one place because two readers need them: `db.ts`, inside a worker
 * where the environment has already been pointed at this worker's database, and
 * `global-setup.ts`, in the main process where it has not.
 */
export const DEFAULT_APP_URL =
  'postgres://investigator_app:investigator_app@localhost:5433/investigator_dev';
export const DEFAULT_OWNER_URL = 'postgres://postgres:postgres@localhost:5433/investigator_dev';

/**
 * Which database this worker owns (T-042).
 *
 * Before this, every spec in the suite wrote into one shared database. Nothing kept two
 * files apart except the discipline of generating unique values, and that discipline broke
 * wherever the state under test is global rather than per-row: T-022's published legal
 * documents needed an advisory lock so that one suite publishing terms did not decide
 * another suite's registration, and T-077, T-080 and T-083 each created a throwaway probe
 * database because a migration cannot be checked against a database that is already migrated.
 *
 * So each worker gets its own database, cloned from a migrated template. "Alone", "in
 * reverse" and "in parallel" then mean the same thing, because there is no longer anything
 * for order to affect.
 *
 * The slot is `VITEST_POOL_ID` — 1..maxWorkers and stable for the life of a worker. Not
 * `VITEST_WORKER_ID`, which increments per FILE (measured: eight files across four workers
 * produced worker ids 0..7 and pool ids 1..4), and would hand every file a database of its
 * own.
 */
export function workerSlot(): number {
  const raw = process.env['VITEST_POOL_ID'];
  if (raw === undefined) return 1; // the main process: global setup, and `fixtures:load`
  const slot = Number.parseInt(raw, 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_WORKERS) {
    // Silently folding slot 5 onto database 1 would put two workers back in one database —
    // exactly the failure this exists to remove — and it would look like a flake.
    throw new Error(
      `VITEST_POOL_ID=${raw} is outside the ${MAX_WORKERS} databases the harness provisions. ` +
        `maxWorkers is fixed in vitest.config.mts and db-budget.ts; override both or neither.`,
    );
  }
  return slot;
}

/** The database a URL names. */
export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/** The same server, a different database. */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/**
 * Names are built here and nowhere else, and every name the harness creates, migrates,
 * truncates or drops matches {@link HARNESS_DATABASE}. A database that does not match is
 * one a person made, and the harness will not touch it.
 */
export const HARNESS_DATABASE = /_(?:tmpl|w\d+)$/;

/** The migrated original. Nothing connects to it but global setup, so it stays pristine. */
export const templateDatabase = (base: string): string => `${databaseName(base)}_tmpl`;

/** This worker's copy of it. */
export const workerDatabase = (base: string, slot: number): string =>
  `${databaseName(base)}_w${slot}`;

/**
 * `postgres`, on the same server — the one database that certainly exists and that we are
 * certainly not trying to create or clone from.
 */
export const maintenanceUrl = (base: string): string => withDatabase(base, 'postgres');
