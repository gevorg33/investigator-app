import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  // The owner, never DATABASE_URL: the runtime role owns nothing and cannot run DDL, which is
  // the point of it (T-073). No fallback to DATABASE_URL, so a missing variable cannot quietly
  // aim a migration at the wrong role.
  dbCredentials: {
    url:
      process.env['MIGRATION_DATABASE_URL'] ??
      'postgres://postgres:postgres@localhost:5433/investigator_dev',
  },
  // Readable SQL we can hand-edit — grants and expand/contract need it (db-migration).
  verbose: true,
  strict: true,
});
