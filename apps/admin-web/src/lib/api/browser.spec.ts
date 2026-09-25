import { beforeEach, describe, expect, it } from 'vitest';
import { api, apiError } from '@/test/api';
import { ApiError, callApi } from './browser';

describe('calling the API from the browser', () => {
  beforeEach(() => api.install());

  it('posts JSON to the same origin, with the session cookie the browser holds', async () => {
    api.on('POST /auth/login', 200, { userId: 'u-1' });
    expect(await callApi('/auth/login', { body: { email: 'a@b.test' } })).toEqual({
      userId: 'u-1',
    });
    const [call] = api.calls;
    expect(call).toMatchObject({
      origin: '',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { email: 'a@b.test' },
    });
    expect(call!.init.credentials).toBe('same-origin');
  });

  it('sends no body and no content type when there is nothing to send', async () => {
    api.on('DELETE /auth/sessions/s-1', 204);
    expect(await callApi('/auth/sessions/s-1', { method: 'DELETE' })).toBeNull();
    api.on('POST /auth/logout', 204);
    await callApi('/auth/logout');
    for (const call of api.calls) {
      expect(call.headers).toEqual({});
      expect(call.init.body).toBeUndefined();
    }
  });

  it('throws the API’s error, as the contract describes it', async () => {
    api.on('POST /auth/login', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
    const e = await callApi('/auth/login', { body: {} }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });
});
