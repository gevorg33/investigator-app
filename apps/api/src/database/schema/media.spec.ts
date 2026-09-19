import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getTableConfig } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './index';
import { mediaAssets } from './media';
import { users } from './users';
import { testPool } from '../../../test/db';


describe('media_assets', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    sql = testPool({ max: 2, role: 'owner' });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('restricts rather than cascades from its owner', () => {
    // A file must never vanish as a side effect of deleting an account; the retention job
    // removes the asset and marks the row first.
    const fk = getTableConfig(mediaAssets).foreignKeys.map((f) => ({
      column: f.reference().columns[0]?.name,
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));
    expect(fk).toEqual([{ column: 'owner_id', target: users, onDelete: 'restrict' }]);
  });

  it('declares one row per public ID', () => {
    const names = getTableConfig(mediaAssets).indexes.map((i) => i.config.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'media_assets_public_id_unique',
        'media_assets_owner_idx',
        'media_assets_category_status_idx',
      ]),
    );
  });

  const seed = async () => {
    const [user] = await db.insert(users).values({ email: `ma-${randomUUID()}@example.test` }).returning();
    const [row] = await db
      .insert(mediaAssets)
      .values({
        ownerId: user?.id ?? '',
        category: 'VERIFICATION_DOCUMENT',
        visibility: 'STAFF_REVIEW_ONLY',
        publicId: `probe/${randomUUID()}`,
        resourceType: 'image',
        declaredMimeType: 'application/pdf',
        declaredBytes: 10,
        authorizationExpiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    return row?.id ?? '';
  };

  /** Drizzle wraps the driver error; 23514 is Postgres's check_violation. */
  const checkViolation = async (run: Promise<unknown>, constraint: string) => {
    const err = await run.then(() => null).catch((e: unknown) => e);
    expect(err, 'expected the database to refuse').not.toBeNull();
    const cause = (err as { cause?: { code?: string; constraint_name?: string } }).cause;
    expect(cause?.code).toBe('23514');
    expect(cause?.constraint_name).toBe(constraint);
  };

  it('refuses a READY row that describes no stored asset', async () => {
    const id = await seed();
    await checkViolation(
      db.update(mediaAssets).set({ uploadStatus: 'READY' }).where(eq(mediaAssets.id, id)),
      'media_assets_ready_has_asset',
    );
  });

  it('refuses a clean scan on something that never finished uploading', async () => {
    const id = await seed();
    await checkViolation(
      db.update(mediaAssets).set({ scanStatus: 'CLEAN' }).where(eq(mediaAssets.id, id)),
      'media_assets_clean_only_when_ready',
    );
  });

  it('refuses a non-positive declared size', async () => {
    const id = await seed();
    await checkViolation(
      db.update(mediaAssets).set({ declaredBytes: 0 }).where(eq(mediaAssets.id, id)),
      'media_assets_declared_bytes_positive',
    );
  });

  it('gives the application role no way to hard-delete a row', async () => {
    const id = await seed();
    const app = testPool({ max: 1, role: 'app' });
    try {
      const err = await app`delete from media_assets where id = ${id}`.then(() => null).catch((e: { code?: string }) => e);
      // 42501: insufficient_privilege.
      expect((err as { code?: string } | null)?.code).toBe('42501');
    } finally {
      await app.end();
    }
  });
});
