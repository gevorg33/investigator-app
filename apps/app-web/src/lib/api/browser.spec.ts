import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, apiError } from '@/test/api';
import { ApiError, callApi } from './browser';
import { pinRole, pinWorkspace } from './workspace';

describe('calling the API from the browser', () => {
  beforeEach(() => api.install());
  afterEach(() => {
    pinWorkspace(null);
    pinRole(null);
  });

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

  it('names the workspace the page was rendered in, so another tab switching cannot move it', async () => {
    pinWorkspace('ws-agency');
    api.on('GET /workspaces', 200, []);
    await callApi('/workspaces', { method: 'GET' });
    expect(api.calls[0]!.headers).toEqual({ 'x-workspace': 'ws-agency' });
  });

  it('says which role the reader chose to act as, when they chose one (T-145)', async () => {
    pinRole('CUSTOMER');
    api.on('PATCH /missions/me/m-1', 200, {});
    await callApi('/missions/me/m-1', { method: 'PATCH', body: { version: 1 } });
    pinRole(null);
    api.on('POST /auth/logout', 204);
    await callApi('/auth/logout');
    expect(api.calls.map((c) => c.headers)).toEqual([
      { 'content-type': 'application/json', 'x-active-role': 'CUSTOMER' },
      {},
    ]);
  });

  it('sends an idempotency key when the route requires one', async () => {
    api.on('POST /agencies', 201, { id: 'a-1' });
    await callApi('/agencies', { body: { name: 'A' }, idempotencyKey: 'k-1' });
    expect(api.calls[0]!.headers).toEqual({
      'content-type': 'application/json',
      'idempotency-key': 'k-1',
    });
  });
});
