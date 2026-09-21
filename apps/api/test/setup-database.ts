import postgres from 'postgres';
import { afterAll, beforeAll, inject } from 'vitest';
import { resetDatabase } from './reset-database';
import {
  DEFAULT_APP_URL,
  DEFAULT_OWNER_URL,
  withDatabase,
  workerDatabase,
  workerSlot,
} from './worker-database';

/**
 * Points this worker at its own database, and empties it before each spec file (T-042).
 *
 * The environment is rewritten here, before the spec file and everything it imports is
 * loaded, because a spec that boots the application gets its connection string from
 * `DATABASE_URL` like the application does — there is no seam to inject through, and there
 * should not be one. `db.ts` reads the same two variables, so helpers and the code under
 * test land in the same database without either knowing which.
 *
 * The file is the unit of isolation, not the test: a spec file starts from the database as
 * the migrations left it, and what it sets up in `beforeAll` survives its own tests. Two
 * files can no longer reach each other at all, being in different databases when they run in
 * different workers and separated by this truncation when they do not.
 */
const slot = workerSlot();
const base = {
  app: process.env['DATABASE_URL'] ?? DEFAULT_APP_URL,
  owner: process.env['MIGRATION_DATABASE_URL'] ?? DEFAULT_OWNER_URL,
};
const mine = workerDatabase(base.owner, slot);

process.env['DATABASE_URL'] = withDatabase(base.app, mine);
process.env['MIGRATION_DATABASE_URL'] = withDatabase(base.owner, mine);

const owner = postgres(process.env['MIGRATION_DATABASE_URL'], { max: 1, onnotice: () => {} });

beforeAll(async () => {
  await resetDatabase(owner, inject('testDatabase'));
});

afterAll(async () => {
  await owner.end();
});
