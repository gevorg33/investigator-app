import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../test/db';
import {
  currentContext,
  runAsUser,
  runInContext,
  type ExecutionContext,
} from '../common/context/execution-context';
import { AuditService } from '../common/audit/audit.service';
import { PlatformContext } from '../common/context/platform-context';
import { databaseSettings, scopedClient } from './scoped-client';
import * as schema from './schema';

const context = (n: number): ExecutionContext => ({
  tenantId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  tenantKind: 'AGENCY',
  userId: `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
  membershipId: `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`,
  sessionId: `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`,
  permissions: [],
});

/** What the database thinks the context is, as the current query sees it. */
const SETTINGS = sql`SELECT current_setting('app.tenant_id', true) AS tenant,
                            current_setting('app.user_id', true) AS "user",
                            current_setting('app.membership_id', true) AS membership,
                            current_setting('app.platform_access', true) AS platform`;

describe('the scoped client', () => {
  let one: postgres.Sql; // a single connection: every query reuses it
  let two: postgres.Sql;

  beforeAll(() => {
    one = testPool({ max: 1 });
    two = testPool({ max: 2 });
  });

  afterAll(async () => {
    await one.end();
    await two.end();
  });

  const settings = async (db: ReturnType<typeof drizzle>) =>
    (await db.execute(SETTINGS))[0] as {
      tenant: string | null;
      user: string | null;
      membership: string | null;
      platform: string | null;
    };

  it('sets the tenant, the user and the membership on a query run in a context', async () => {
    const db = drizzle(scopedClient(one), { schema });
    const c = context(1);
    expect(await runInContext(c, () => settings(db))).toEqual({
      tenant: c.tenantId,
      user: c.userId,
      membership: c.membershipId,
      platform: '',
    });
  });

  it('sets it for queries drizzle reads as arrays (.values()) too', async () => {
    const db = drizzle(scopedClient(one), { schema });
    const c = context(2);
    const rows = await runInContext(
      c,
      async () =>
        await db
          .select({ tenant: sql<string>`current_setting('app.tenant_id', true)` })
          .from(schema.roles)
          .limit(1),
    );
    expect(rows).toEqual([{ tenant: c.tenantId }]);
  });

  it('runs a query that is built in a context but awaited outside it with NO context', async () => {
    // Drizzle queries are lazy: nothing runs until awaited. One returned un-awaited from inside
    // runInContext executes after the context has ended — and so without one, which RLS turns
    // into "no rows" (T-077). Pinned here because it is the footgun: always await inside.
    //
    // Asserted as policies read it, through app_current_tenant(). The raw setting is NULL on a
    // connection that never set it and '' on one that did, so asserting on it made this pass or
    // fail on which pooled connection the test happened to get — found by shuffling (T-064).
    const db = drizzle(scopedClient(one), { schema });
    // Give the one connection a history first, so the raw setting reads '' rather than NULL:
    // the worst case, made certain instead of left to the order tests happen to run in.
    await runInContext(context(12), () => db.select().from(schema.roles).limit(1));
    const lazy = runInContext(context(11), () =>
      db
        .select({ tenant: sql<string | null>`app_current_tenant()` })
        .from(schema.roles)
        .limit(1),
    );
    expect(await lazy).toEqual([{ tenant: null }]);
  });

  it('sets it as the first statement of a transaction, for every query inside', async () => {
    const db = drizzle(scopedClient(one), { schema });
    const c = context(3);
    const seen = await runInContext(c, () =>
      db.transaction(async (tx) => [
        ((await tx.execute(SETTINGS))[0] as { tenant: string }).tenant,
        ((await tx.execute(SETTINGS))[0] as { tenant: string }).tenant,
      ]),
    );
    expect(seen).toEqual([c.tenantId, c.tenantId]);
  });

  it('honours transaction options, still setting the context first', async () => {
    const client = scopedClient(one);
    const c = context(4);
    const [row] = await runInContext(c, () =>
      client.begin(
        'isolation level serializable',
        (tx) =>
          tx`SELECT current_setting('app.tenant_id', true) AS tenant, current_setting('transaction_isolation') AS iso`,
      ),
    );
    expect(row).toEqual({ tenant: c.tenantId, iso: 'serializable' });
  });

  it('leaves a query outside any context untouched', async () => {
    const db = drizzle(scopedClient(one), { schema });
    const { tenant } = await settings(db);
    // NULL on a connection that never had it set, '' on one that did — never a tenant.
    expect(tenant === null || tenant === '').toBe(true);
  });

  it('never carries a context over on a reused connection', async () => {
    // One connection. Tenant A's query commits; the next query, outside any context, must see
    // nothing of A; then tenant B's must see B. This is what session-level SET would get wrong.
    const db = drizzle(scopedClient(one), { schema });
    const [a, b] = [context(5), context(6)];
    expect((await runInContext(a, () => settings(db))).tenant).toBe(a.tenantId);
    expect((await settings(db)).tenant).toBe('');
    expect((await runInContext(b, () => settings(db))).tenant).toBe(b.tenantId);
    expect((await settings(db)).tenant).toBe('');
  });

  it('never crosses two contexts running at once on a small pool', async () => {
    const db = drizzle(scopedClient(two), { schema });
    const contexts = [context(7), context(8)];
    const results = await Promise.all(
      Array.from({ length: 60 }, (_, i) => {
        const c = contexts[i % 2]!;
        return runInContext(c, async () => {
          const seen =
            i % 3 === 0
              ? await db.transaction((tx) => tx.execute(SETTINGS))
              : await db.execute(SETTINGS);
          return { expected: c.tenantId, seen: (seen[0] as { tenant: string }).tenant };
        });
      }),
    );
    expect(results.filter((r) => r.seen !== r.expected)).toEqual([]);
  });

  it('reports a failing query through await and through .catch alike', async () => {
    const client = scopedClient(one);
    await expect(runInContext(context(9), () => client.unsafe('SELECT nope'))).rejects.toThrow(
      /column "nope" does not exist/,
    );
    const caught = await runInContext(context(9), () =>
      (client.unsafe('SELECT nope') as unknown as Promise<unknown>).catch((e: Error) => e.message),
    );
    expect(caught).toMatch(/column "nope" does not exist/);
  });

  it('starts a transaction outside any context without setting one', async () => {
    const db = drizzle(scopedClient(one), { schema });
    const seen = await db.transaction(
      async (tx) => (await tx.execute(SETTINGS))[0] as { tenant: string | null },
    );
    expect(seen.tenant === null || seen.tenant === '').toBe(true);
  });

  it('runs a query once, however many times it is awaited', async () => {
    // Awaiting the same pending query twice must not execute it twice — for a write, that would
    // be a double insert. Both awaits see the same transaction id.
    const client = scopedClient(one);
    const ids = await runInContext(context(12), async () => {
      const q = client.unsafe('SELECT txid_current()::text AS id') as unknown as Promise<
        Array<{ id: string }>
      >;
      const [first, second] = await Promise.all([q, q]);
      return [first[0]!.id, second[0]!.id];
    });
    expect(ids[0]).toBe(ids[1]);
  });

  it('passes every other property through to the pool', () => {
    const client = scopedClient(one);
    expect(client.options).toBe(one.options);
  });

  it('does not leak the context out of the code it wraps', async () => {
    await runInContext(context(10), async () => {
      expect(currentContext()?.tenantId).toBe(context(10).tenantId);
    });
    expect(currentContext()).toBeUndefined();
  });

  describe('the three ways a query gets a context', () => {
    it('sends a request’s workspace, user and membership', async () => {
      const db = drizzle(scopedClient(one), { schema });
      const c = context(20);
      const seen = await runInContext(c, () => settings(db));
      expect(seen).toEqual({
        tenant: c.tenantId,
        user: c.userId,
        membership: c.membershipId,
        platform: '',
      });
    });

    it('sends the user alone before a workspace is chosen', async () => {
      const db = drizzle(scopedClient(one), { schema });
      const seen = await runAsUser('u-21', () => settings(db));
      expect(seen).toEqual({ tenant: '', user: 'u-21', membership: '', platform: '' });
    });

    it('sends platform access on its own for a system operation', async () => {
      // Entered through the real PlatformContext, which audits the crossing first: what the
      // scoped client reads is what that entry left behind.
      const db = drizzle(scopedClient(one), { schema });
      const platform = new PlatformContext(new AuditService(db));
      const seen = await platform.asSystem('assignment.create_from_payment', {}, () =>
        settings(db),
      );
      expect(seen).toEqual({ tenant: '', user: '', membership: '', platform: 'on' });
    });

    it('sends nothing at all outside all three', () => {
      expect(databaseSettings()).toBeUndefined();
    });
  });
});
