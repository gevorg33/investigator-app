import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../database/schema';
import { IdempotencyService } from './idempotency.service';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

describe('idempotency keys', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const service = new IdempotencyService();
  const actorId = '00000000-0000-4000-8000-00000000aaaa';

  beforeAll(() => {
    sql = postgres(URL, { max: 6, onnotice: () => {} });
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
