import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POOL_MAX } from '../src/database/database.module';
import { HEADROOM, MAX_WORKERS, PER_FILE_BUDGET, TEST_POOL_MAX } from './db-budget';
import { testPool } from './db';

/**
 * The suite fits inside PostgreSQL's connection limit by construction, not by luck (T-069).
 *
 * Before this, specs opened pools of up to 8 each and ran on as many workers as the machine had
 * CPUs. The worst case on a 10-core laptop was 92 of 97 usable connections — safe only because
 * postgres.js opens connections lazily and specs rarely peak together. T-073 gives every spec a
 * second pool, which would have pushed that worst case past the limit.
 */
const API = join(__dirname, '..');
/**
 * `db.ts` and the application's own module are the two ways a spec reaches the database.
 *
 * The two harness files are not specs and cannot use either. `global-setup.ts` runs in the
 * main process before any worker exists, connecting to databases it is in the middle of
 * creating; `setup-database.ts` is what decides which database `db.ts` will then read from,
 * so it cannot ask `db.ts` for a pool. Both hold one connection at a time and are counted in
 * `PER_FILE_BUDGET` (T-042).
 */
const ALLOWED_POOL_FACTORIES = [
  'test/db.ts',
  'src/database/database.module.ts',
  'test/global-setup.ts',
  'test/setup-database.ts',
];

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return e.name.endsWith('.ts') ? [path] : [];
  });

const sources = [...files(join(API, 'src')), ...files(join(API, 'test'))].map((path) => ({
  path: relative(API, path),
  source: readFileSync(path, 'utf8'),
}));
const specs = sources.filter((f) => f.path.endsWith('.spec.ts'));

/** What one spec file can hold at once: its helper pools, plus the app's pool if it boots the app. */
const connectionsFor = (source: string): number => {
  const helper = [...source.matchAll(/testPool\((?:\{([^}]*)\})?\)/g)].reduce((sum, m) => {
    const explicit = /max:\s*(\d+)/.exec(m[1] ?? '');
    return sum + Math.min(explicit ? Number(explicit[1]) : TEST_POOL_MAX, TEST_POOL_MAX);
  }, 0);
  const bootsApp = /\b(AppModule|DatabaseModule|createPool)\b/.test(source);
  return helper + (bootsApp ? POOL_MAX : 0);
};

describe('the test suite’s connection budget', () => {
  it('found the specs to check', () => {
    expect(specs.length).toBeGreaterThan(50);
    expect(specs.filter((f) => f.source.includes('testPool(')).length).toBeGreaterThan(20);
  });

  it('opens pools only through testPool (and the app through its module)', () => {
    const offenders = sources
      .filter((f) => !ALLOWED_POOL_FACTORIES.includes(f.path))
      .filter((f) => /\bpostgres\(/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps every spec file within its per-file budget', () => {
    const over = specs
      .map((f) => ({ path: f.path, connections: connectionsFor(f.source) }))
      .filter((f) => f.connections > PER_FILE_BUDGET);
    expect(over).toEqual([]);
  });

  it('budgets for the app pool plus two helper pools, which T-073 needs', () => {
    expect(PER_FILE_BUDGET).toBeGreaterThanOrEqual(POOL_MAX + 2 * TEST_POOL_MAX);
  });

  it('budgets for the reset connection each spec file holds (T-042)', () => {
    expect(PER_FILE_BUDGET).toBeGreaterThanOrEqual(POOL_MAX + 2 * TEST_POOL_MAX + 1);
  });

  it('runs on a fixed number of workers, taken from the budget', () => {
    const config = readFileSync(join(API, 'vitest.config.mts'), 'utf8');
    expect(config).toMatch(/maxWorkers:\s*MAX_WORKERS/);
  });

  describe('against the live server', () => {
    let sql: ReturnType<typeof testPool>;

    beforeAll(() => {
      sql = testPool({ max: 1 });
    });

    afterAll(async () => {
      await sql.end();
    });

    it('fits the worst case inside max_connections, with headroom', async () => {
      const [row] = await sql<{ max: number; reserved: number }[]>`
        SELECT current_setting('max_connections')::int AS max,
               current_setting('superuser_reserved_connections')::int AS reserved`;
      const usable = row!.max - row!.reserved - HEADROOM;
      expect(MAX_WORKERS * PER_FILE_BUDGET).toBeLessThanOrEqual(usable);
    });
  });
});
