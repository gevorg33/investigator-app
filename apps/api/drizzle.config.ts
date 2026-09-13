import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './src/database/migrations',
  dbCredentials: {
    url:
      process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev',
  },
  // Readable SQL we can hand-edit — grants and expand/contract need it (db-migration).
  verbose: true,
  strict: true,
});
