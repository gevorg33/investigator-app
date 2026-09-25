import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, 'migrations');
const migrations = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ file: f, sql: readFileSync(join(DIR, f), 'utf8') }));

/**
 * Guards on generated SQL. drizzle-kit writes these files, and a generator that is wrong in
 * a way nobody notices produces a migration that fails only when applied.
 */
describe('migration files', () => {
  it('found the migrations to check', () => {
    expect(migrations.length).toBeGreaterThan(5);
  });

  it('never quote a parameterised PostGIS type', () => {
    // drizzle-kit quotes custom column types as identifiers, and "geography(Point, 4326)" in
    // quotes names a type that does not exist. Migration 0006 had to be unquoted by hand; this
    // fails the build if a regenerated migration ever brings the quoting back.
    for (const { file, sql } of migrations) {
      expect(sql, file).not.toMatch(/"geography\(/);
      expect(sql, file).not.toMatch(/"geometry\(/);
    }
  });

  it('index geography columns with GIST, never btree', () => {
    const service = migrations.find((m) => m.file.startsWith('0006_') && !m.file.includes('.down'));
    expect(service?.sql).toMatch(
      /CREATE INDEX "service_areas_area_gist" ON "service_areas" USING gist \("area"\)/,
    );
  });

  it('pair every migration with a down path', () => {
    const ups = migrations
      .filter((m) => !m.file.endsWith('.down.sql'))
      .map((m) => m.file.replace(/\.sql$/, ''));
    const downs = new Set(
      migrations
        .filter((m) => m.file.endsWith('.down.sql'))
        .map((m) => m.file.replace(/\.down\.sql$/, '')),
    );
    for (const up of ups) expect(downs.has(up), `${up} has no .down.sql`).toBe(true);
  });
});
