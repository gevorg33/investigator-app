import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { IdempotencyService } from './idempotency.service';
import { testPool } from '../../../test/db';
import { agency, member } from '../../../test/workspace-fixtures';
import { runInContext, type ExecutionContext } from '../context/execution-context';
import { scopedClient } from '../../database/scoped-client';


describe('idempotency keys', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const service = new IdempotencyService();
  const actorId = '00000000-0000-4000-8000-00000000aaaa';

  beforeAll(() => {
    sql = testPool();
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  const scope = (over: { key?: string; request?: unknown; actorId?: string } = {}) => ({
    actorId: over.actorId ?? actorId,
    endpoint: 'quote.accept',
    key: over.key ?? randomUUID(),
    request: over.request ?? { quoteId: 'q1' },
  });

  it('claims a key nobody has used', async () => {
    const s = scope();
    const claim = await db.transaction(async (tx) => service.claim(tx, s));
    expect(claim.status).toBe('CLAIMED');
  });

  it('replays the first call’s response rather than doing the work again', async () => {
    const s = scope();
    await db.transaction(async (tx) => {
      await service.claim(tx, s);
      await service.complete(tx, s, { status: 200, body: { id: 'q1', status: 'ACCEPTED' } });
    });

    const replay = await db.transaction(async (tx) => service.claim(tx, s));
    expect(replay).toEqual({
      status: 'REPLAY',
      responseStatus: 200,
      responseBody: { id: 'q1', status: 'ACCEPTED' },
    });
  });

  it('refuses a key reused for a different request', async () => {
    // "A key bound to one request must never execute a different one."
    const s = scope();
    await db.transaction(async (tx) => {
      await service.claim(tx, s);
      await service.complete(tx, s, { status: 200, body: {} });
    });

    await expect(
      db.transaction(async (tx) =>
        service.claim(tx, { ...s, request: { quoteId: 'a different quote' } }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('ignores key order in the request when deciding whether it is the same one', async () => {
    const s = scope({ request: { a: 1, b: 2 } });
    await db.transaction(async (tx) => {
      await service.claim(tx, s);
      await service.complete(tx, s, { status: 200, body: { ok: true } });
    });
    const replay = await db.transaction(async (tx) =>
      service.claim(tx, { ...s, request: { b: 2, a: 1 } }),
    );
    expect(replay.status).toBe('REPLAY');
  });

  it('refuses a replay while the first call is still running', async () => {
    // Not queued behind it and not executed alongside it: refused as retryable.
    const s = scope();
    await db.transaction(async (tx) => {
      await service.claim(tx, s);
    });
    await expect(db.transaction(async (tx) => service.claim(tx, s))).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    });
  });

  it('lets two actors use the same key without colliding', async () => {
    // "Scope is per actor, per endpoint."
    const key = randomUUID();
    const other = '00000000-0000-4000-8000-00000000bbbb';
    const first = await db.transaction(async (tx) => service.claim(tx, scope({ key })));
    const second = await db.transaction(async (tx) =>
      service.claim(tx, scope({ key, actorId: other })),
    );
    expect(first.status).toBe('CLAIMED');
    expect(second.status).toBe('CLAIMED');
  });

  it('frees the key when the work it guarded rolled back', async () => {
    // "A key recorded for work that rolled back blocks a legitimate retry." The row and the
    // effect share a transaction, so a rollback takes the key with it.
    const s = scope();
    const boom = new Error('the work failed');
    await expect(
      db.transaction(async (tx) => {
        await service.claim(tx, s);
        throw boom;
      }),
    ).rejects.toBe(boom);

    const retry = await db.transaction(async (tx) => service.claim(tx, s));
    expect(retry.status).toBe('CLAIMED');
  });

  it('lets exactly one of two simultaneous claims through', async () => {
    // The unique index is the mechanism. The loser blocks on it until the winner commits, then
    // finds a finished row to replay or an unfinished one to refuse — never a second claim.
    const s = scope();
    const attempt = () =>
      db.transaction(async (tx) => {
        const claim = await service.claim(tx, s);
        if (claim.status === 'CLAIMED') {
          await service.complete(tx, s, { status: 200, body: { winner: true } });
        }
        return claim.status;
      });

    const results = await Promise.allSettled([attempt(), attempt()]);
    const claimed = results.filter((r) => r.status === 'fulfilled' && r.value === 'CLAIMED');
    expect(claimed).toHaveLength(1);
  });
});

/**
 * Keys are per workspace (T-076). The same person using the same key in two workspaces makes two
 * independent claims, and each replays its own response — a lookup or completion by actor,
 * endpoint and key alone would have reached the other workspace's row.
 */
describe('idempotency keys across workspaces', () => {
  let app: postgres.Sql;
  let ownerPool: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const service = new IdempotencyService();

  beforeAll(() => {
    app = testPool();
    ownerPool = testPool({ role: 'owner' });
    db = drizzle(scopedClient(app), { schema });
  });

  afterAll(async () => {
    await app.end();
    await ownerPool.end();
  });

  const contextFor = (userId: string, tenantId: string, membershipId: string): ExecutionContext => ({
    tenantId,
    tenantKind: 'AGENCY',
    userId,
    membershipId,
    permissions: [],
  });

  it('claims, completes and replays separately in each workspace', async () => {
    const me = await member(ownerPool);
    const a = await agency(ownerPool, [{ userId: me.actor.userId }]);
    const b = await agency(ownerPool, [{ userId: me.actor.userId }]);
    const scope = { actorId: me.actor.userId, endpoint: 'probe.cross', key: 'same-key', request: { x: 1 } };

    const run = (ctx: ExecutionContext, body: unknown) =>
      runInContext(ctx, () =>
        db.transaction(async (tx) => {
          const claim = await service.claim(tx, scope);
          if (claim.status === 'CLAIMED') await service.complete(tx, scope, { status: 200, body });
          return claim;
        }),
      );

    const inA = contextFor(me.actor.userId, a.tenantId, a.memberships[0]!);
    const inB = contextFor(me.actor.userId, b.tenantId, b.memberships[0]!);
    expect(await run(inA, 'from A')).toEqual({ status: 'CLAIMED' });
    expect(await run(inB, 'from B')).toEqual({ status: 'CLAIMED' });
    expect(await run(inA, 'ignored')).toEqual({ status: 'REPLAY', responseStatus: 200, responseBody: 'from A' });
    expect(await run(inB, 'ignored')).toEqual({ status: 'REPLAY', responseStatus: 200, responseBody: 'from B' });
  });
});
