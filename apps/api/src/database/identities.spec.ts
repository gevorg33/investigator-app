import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import { userIdentities, users } from './schema';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

/**
 * The shape of identity linking is the thing that is expensive to change once accounts
 * depend on it, so the constraints are pinned here before the first provider ships
 * (T-062) rather than after.
 */
describe('external identity linking', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const newUser = async (): Promise<string> => {
    const [row] = await db
      .insert(users)
      .values({ email: `identity-${randomUUID()}@example.test` })
      .returning();
    return row?.id ?? '';
  };

  /**
   * Drizzle wraps the driver error, so the message is its own. 23505 is the Postgres
   * code for a unique violation -- asserting on it proves the constraint fired rather
   * than the insert failing for some unrelated reason.
   */
  const uniqueViolation = async (run: Promise<unknown>): Promise<void> => {
    const err = await run.then(() => null).catch((e: unknown) => e);
    expect(err, 'expected the insert to be rejected').not.toBeNull();
    const code = (err as { cause?: { code?: string }; code?: string }).cause?.code
      ?? (err as { code?: string }).code;
    expect(code).toBe('23505');
  };

  beforeAll(() => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('attaches a provider account to an existing user', async () => {
    const userId = await newUser();
    await db.insert(userIdentities).values({
      userId,
      provider: 'GOOGLE',
      providerAccountId: randomUUID(),
    });
    const rows = await db.query.userIdentities.findMany({ where: (t, { eq }) => eq(t.userId, userId) });
    expect(rows).toHaveLength(1);
  });

  it('refuses to let a second account claim the same provider identity', async () => {
    const providerAccountId = randomUUID();
    await db.insert(userIdentities).values({
      userId: await newUser(),
      provider: 'GOOGLE',
      providerAccountId,
    });

    // Otherwise one Google account could be attached to two users here, and whichever
    // signed in would be ambiguous.
    await uniqueViolation(
      db
        .insert(userIdentities)
        .values({ userId: await newUser(), provider: 'GOOGLE', providerAccountId }),
    );
  });

  it('allows only one link per provider per user', async () => {
    const userId = await newUser();
    await db
      .insert(userIdentities)
      .values({ userId, provider: 'GOOGLE', providerAccountId: randomUUID() });

    // Re-authenticating must update the existing row, never accumulate rows.
    await uniqueViolation(
      db
        .insert(userIdentities)
        .values({ userId, provider: 'GOOGLE', providerAccountId: randomUUID() }),
    );
  });

  it('stores no credential — only the provider’s opaque account id', async () => {
    const userId = await newUser();
    await db.insert(userIdentities).values({
      userId,
      provider: 'GOOGLE',
      providerAccountId: randomUUID(),
      providerEmail: 'someone@gmail.test',
    });
    const [row] = await db.query.userIdentities.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });
    // No token, no refresh token, no secret: nothing here is usable to sign in anywhere.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'createdAt',
      'id',
      'lastUsedAt',
      'provider',
      'providerAccountId',
      'providerEmail',
      'userId',
    ]);
  });

  it('disappears with the user', async () => {
    const userId = await newUser();
    await db
      .insert(userIdentities)
      .values({ userId, provider: 'GOOGLE', providerAccountId: randomUUID() });
    await db.delete(users).where((await import('drizzle-orm')).eq(users.id, userId));

    const rows = await db.query.userIdentities.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });
    expect(rows).toHaveLength(0);
  });
});
