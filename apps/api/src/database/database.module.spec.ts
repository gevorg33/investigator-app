import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPool, DatabaseModule, DB, type Db } from './database.module';

const LOCAL = 'postgres://postgres:postgres@localhost:5433/investigator_dev';

describe('database module', () => {
  const original = process.env['DATABASE_URL'];

  afterEach(() => {
    if (original === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = original;
  });

  it('closes the pool drizzle actually uses when the application stops', async () => {
    process.env['DATABASE_URL'] = original ?? LOCAL;
    const mod = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();
    const app = mod.createNestApplication();
    await app.init();
    const db = app.get<Db>(DB);
    await expect(db.execute(sql`select 1`)).resolves.toBeDefined();

    await app.close();

    // Regression. Before the fix this query still succeeded: the shutdown hook closed a
    // separate single-connection pool, and the one serving queries stayed open.
    await expect(db.execute(sql`select 1`)).rejects.toThrow();
  });

  it('refuses to start without DATABASE_URL, and says which variable', async () => {
    delete process.env['DATABASE_URL'];
    await expect(
      Test.createTestingModule({ imports: [DatabaseModule] }).compile(),
    ).rejects.toThrow(/DATABASE_URL is required/);
  });

  it('builds a pool from a URL', async () => {
    const pool = createPool(original ?? LOCAL);
    await expect(pool`select 1 as ok`).resolves.toEqual([{ ok: 1 }]);
    await pool.end({ timeout: 1 });
  });

  it('never lets the driver print a server notice, which can carry query text', async () => {
    // The driver's default prints every NOTICE to the console. A notice can quote the
    // statement that raised it — personal data included — and console output is not
    // subject to log redaction.
    const printed: unknown[] = [];
    const capture = (...args: unknown[]) => {
      printed.push(args);
    };
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(capture),
      vi.spyOn(console, 'warn').mockImplementation(capture),
      vi.spyOn(console, 'info').mockImplementation(capture),
    ];
    const pool = createPool(original ?? LOCAL);
    try {
      await pool`do $$ begin raise notice 'probe notice carrying person@example.test'; end $$`;
    } finally {
      await pool.end({ timeout: 1 });
      for (const spy of spies) spy.mockRestore();
    }
    expect(JSON.stringify(printed)).not.toContain('probe notice');
  });
});
