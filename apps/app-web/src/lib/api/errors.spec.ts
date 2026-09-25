import { describe, expect, it } from 'vitest';
import { ApiError, bodyOf, toApiError } from './errors';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('an API error', () => {
  it('keeps what the contract gives: the code to branch on, the key to translate, the reference', async () => {
    const e = await toApiError(
      json(422, {
        error: {
          code: 'VALIDATION_FAILED',
          messageKey: 'error.common.validation_failed',
          correlationId: 'c-1',
          details: [
            { field: 'email', code: 'invalid', messageKey: 'error.common.validation_failed' },
          ],
        },
      }),
    );
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({
      name: 'ApiError',
      message: '422 VALIDATION_FAILED',
      status: 422,
      code: 'VALIDATION_FAILED',
      messageKey: 'error.common.validation_failed',
      correlationId: 'c-1',
    });
    expect(e.details).toEqual([
      { field: 'email', code: 'invalid', messageKey: 'error.common.validation_failed' },
    ]);
  });

  it('drops details and a reference that are not the contract’s shape', async () => {
    const e = await toApiError(
      json(401, {
        error: { code: 'UNAUTHENTICATED', messageKey: 'k', details: 'x', correlationId: 7 },
      }),
    );
    expect(e.details).toEqual([]);
    expect(e.correlationId).toBeNull();
  });

  it.each([
    ['a proxy’s HTML page', new Response('<html>Bad gateway</html>', { status: 502 })],
    ['an empty body', new Response(null, { status: 503 })],
    ['JSON without an error', json(500, { message: 'boom' })],
    ['an error without a message key', json(500, { error: { code: 'X' } })],
  ])('reads %s as something went wrong, never as nothing', async (_, res) => {
    const e = await toApiError(res);
    expect([e.status, e.code, e.messageKey]).toEqual([
      res.status,
      'INTERNAL_ERROR',
      'error.common.internal',
    ]);
  });
});

describe('a response body', () => {
  it('is its JSON when it has some, and null when it has none', async () => {
    expect(await bodyOf(json(200, { userId: 'u' }))).toEqual({ userId: 'u' });
    expect(await bodyOf(new Response(null, { status: 204 }))).toBeNull();
    expect(await bodyOf(new Response('ok', { status: 200 }))).toBeNull();
  });
});
