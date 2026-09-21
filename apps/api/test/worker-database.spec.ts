import { describe, expect, it } from 'vitest';
import { MAX_WORKERS } from './db-budget';
import { TEST_DATABASE_URL, TEST_OWNER_URL } from './db';
import {
  HARNESS_DATABASE,
  databaseName,
  maintenanceUrl,
  templateDatabase,
  withDatabase,
  workerDatabase,
  workerSlot,
} from './worker-database';

const BASE = 'postgres://someone:secret@db.internal:5432/investigator_test';

describe('one database per worker', () => {
  it('derives this worker`s database from its pool slot', () => {
    expect(workerDatabase(BASE, 3)).toBe('investigator_test_w3');
    expect(templateDatabase(BASE)).toBe('investigator_test_tmpl');
  });

  it('keeps the server, the credentials and the port', () => {
    const url = new URL(withDatabase(BASE, 'investigator_test_w1'));
    expect([url.host, url.username, url.password]).toEqual([
      'db.internal:5432',
      'someone',
      'secret',
    ]);
  });

  it('points CREATE DATABASE at `postgres`, which always exists and is never the target', () => {
    expect(databaseName(maintenanceUrl(BASE))).toBe('postgres');
  });

  it('recognises only the names it makes itself', () => {
    expect(HARNESS_DATABASE.test('investigator_test_w1')).toBe(true);
    expect(HARNESS_DATABASE.test('investigator_test_tmpl')).toBe(true);
    // The two that matter: the real databases the harness must never create, clone or empty.
    expect(HARNESS_DATABASE.test('investigator_dev')).toBe(false);
    expect(HARNESS_DATABASE.test('investigator_prod')).toBe(false);
  });

  it('refuses a slot it has no database for, rather than sharing one', () => {
    const was = process.env['VITEST_POOL_ID'];
    try {
      process.env['VITEST_POOL_ID'] = String(MAX_WORKERS + 1);
      // Folding slot 5 onto database 1 would put two workers back in one database. That is the
      // bug this whole mechanism removes, and it would present as an unreproducible flake.
      expect(() => workerSlot()).toThrow(/outside the \d+ databases/);
    } finally {
      process.env['VITEST_POOL_ID'] = was;
    }
  });

  it('falls back to the first slot outside the runner, which is how fixtures:load runs', () => {
    const was = process.env['VITEST_POOL_ID'];
    try {
      delete process.env['VITEST_POOL_ID'];
      expect(workerSlot()).toBe(1);
    } finally {
      process.env['VITEST_POOL_ID'] = was;
    }
  });

  it('has actually pointed this worker at its own database', () => {
    const mine = `_w${workerSlot()}`;
    // Not a restatement of the helper: this reads what `db.ts` resolved at import time, which
    // is what every spec in the suite connects through.
    expect(databaseName(TEST_DATABASE_URL).endsWith(mine)).toBe(true);
    expect(databaseName(TEST_OWNER_URL).endsWith(mine)).toBe(true);
    expect(databaseName(TEST_DATABASE_URL)).toBe(databaseName(TEST_OWNER_URL));
  });
});
