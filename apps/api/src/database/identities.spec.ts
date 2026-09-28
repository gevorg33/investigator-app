import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { oauthAttempts, userIdentities, users } from './schema';
import { testPool } from '../../test/db';

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
    const code =
      (err as { cause?: { code?: string }; code?: string }).cause?.code ??
      (err as { code?: string }).code;
    expect(code).toBe('23505');
  };

  beforeAll(() => {
    sql = testPool({ role: 'owner' });
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
    const rows = await db.query.userIdentities.findMany({
      where: (t, { eq }) => eq(t.userId, userId),
    });
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

/** A trip to Google and back (T-062): what its row holds to, whoever writes it. */
describe('oauth attempts', () => {
  let sql: postgres.Sql;
  beforeAll(() => {
    sql = testPool({ role: 'owner' });
  });
  afterAll(async () => {
    await sql.end();
  });

  const insert = (
    over: {
      intent?: 'SIGN_IN' | 'LINK';
      user_id?: string;
      signup_token_hash?: string;
      provider_account_id?: string;
      signup_expires_at?: Date;
    } = {},
  ) => sql`
    INSERT INTO oauth_attempts (provider, intent, state_hash, nonce_hash, expires_at, user_id,
                                signup_token_hash, provider_account_id, signup_expires_at)
    VALUES ('GOOGLE', ${over.intent ?? 'SIGN_IN'}, ${randomUUID()}, 'n',
            ${new Date(Date.now() + 60_000)}, ${over.user_id ?? null},
            ${over.signup_token_hash ?? null}, ${over.provider_account_id ?? null},
            ${over.signup_expires_at ?? null})`;

  it('goes with the account that started a link', () => {
    const [fk] = getTableConfig(oauthAttempts).foreignKeys;
    const ref = fk!.reference();
    expect([
      ref.columns.map((c) => c.name),
      getTableConfig(ref.foreignTable).name,
      fk!.onDelete,
    ]).toEqual([['user_id'], 'users', 'cascade']);
  });

  it('names an account for a link, and only for a link', async () => {
    const [user] = await sql<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`oauth-${randomUUID()}@example.test`}) RETURNING id`;
    await expect(insert({ intent: 'LINK' })).rejects.toMatchObject({
      constraint_name: 'oauth_attempts_link_has_user',
    });
    await expect(insert({ user_id: user!.id })).rejects.toMatchObject({
      constraint_name: 'oauth_attempts_link_has_user',
    });
    await insert({ intent: 'LINK', user_id: user!.id });
  });

  it('holds a waiting sign-up whole, or not at all', async () => {
    await expect(insert({ signup_token_hash: 'h' })).rejects.toMatchObject({
      constraint_name: 'oauth_attempts_signup_complete',
    });
    await insert({
      signup_token_hash: randomUUID(),
      provider_account_id: 'sub',
      signup_expires_at: new Date(Date.now() + 60_000),
    });
  });
});
