import { describe, expect, it } from 'vitest';
import { IdempotencyService } from './idempotency.service';

/**
 * The window between the INSERT losing its conflict and the SELECT that follows it.
 *
 * A real database can produce this — the first caller rolled back in the gap, taking its key
 * with it — but not on demand, and it matters: the right answer is that this caller is now the
 * first call, not that the key is mysteriously missing.
 */
describe('a key that disappears between the insert and the read', () => {
  it('claims it on the retry rather than failing', async () => {
    let selects = 0;
    const inserts: number[] = [];
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              inserts.push(1);
              // Lost the race the first time; free the second, because the winner rolled back.
              return inserts.length === 1 ? [] : [{ id: 'k1' }];
            },
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: async () => {
            selects += 1;
            return [];
          },
        }),
      }),
    };

    const claim = await new IdempotencyService().claim(tx as never, {
      actorId: 'a1',
      endpoint: 'quote.accept',
      key: 'k',
      request: { quoteId: 'q1' },
    });

    expect(claim).toEqual({ status: 'CLAIMED' });
    expect(selects).toBe(1);
    expect(inserts).toHaveLength(2);
  });
});

describe('completing a key', () => {
  it('stores the response against the key that guarded the work', async () => {
    const sets: unknown[] = [];
    const tx = {
      update: () => ({
        set: (values: unknown) => {
          sets.push(values);
          return { where: async () => undefined };
        },
      }),
    };

    await new IdempotencyService().complete(
      tx as never,
      { actorId: 'a1', endpoint: 'quote.accept', key: 'k' },
      { status: 200, body: { id: 'q1' } },
    );

    expect(sets[0]).toMatchObject({ responseStatus: 200, responseBody: { id: 'q1' } });
    // Completion is what turns a claimed key into a replayable one, so the instant matters.
    expect((sets[0] as { completedAt: Date }).completedAt).toBeInstanceOf(Date);
  });
});

describe('the fingerprint the claim is bound to', () => {
  it('is taken over the request, so the same key with a different body is a different request', async () => {
    const seen: string[] = [];
    const tx = {
      insert: () => ({
        values: (values: { requestFingerprint: string }) => {
          seen.push(values.requestFingerprint);
          return { onConflictDoNothing: () => ({ returning: async () => [{ id: 'k1' }] }) };
        },
      }),
    };
    const service = new IdempotencyService();
    const scope = { actorId: 'a1', endpoint: 'quote.accept', key: 'k' };

    await service.claim(tx as never, { ...scope, request: { quoteId: 'q1' } });
    await service.claim(tx as never, { ...scope, request: { quoteId: 'q2' } });

    expect(seen[0]).not.toBe(seen[1]);
  });
});
