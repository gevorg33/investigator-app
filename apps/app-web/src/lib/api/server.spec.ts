import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { request } from '@/test/request';
import { getAccount, getOutstanding, serverApi } from './server';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

describe('calling the API from the Next server', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('asks as the reader: their session and chosen role go with it, and nothing is cached', async () => {
    request.cookies.set('investigator_session', 'refresh-token');
    request.cookies.set('active_role', 'INVESTIGATOR');
    request.cookies.set('locale', 'hy');
    api.on('GET /me', 200, { id: 'u-1' });
    expect(await serverApi('/me')).toEqual({ id: 'u-1' });
    const [call] = api.calls;
    expect(call!.origin).toBe('http://localhost:3001');
    // Only the session cookie is forwarded — nothing else the browser sent reaches the API.
    expect(call!.headers).toEqual({
      cookie: 'investigator_session=refresh-token',
      'x-active-role': 'INVESTIGATOR',
    });
    expect(call!.init.cache).toBe('no-store');
  });

  it('reaches the API at its internal address where one is configured', async () => {
    vi.stubEnv('API_INTERNAL_URL', 'http://api:3001');
    api.on('PATCH /me/preferences', 204);
    expect(
      await serverApi('/me/preferences', { method: 'PATCH', body: { locale: 'ru' } }),
    ).toBeNull();
    expect(api.calls[0]).toMatchObject({
      origin: 'http://api:3001',
      headers: { 'content-type': 'application/json' },
      body: { locale: 'ru' },
    });
  });

  it('throws what the API refused with', async () => {
    api.on('GET /legal/outstanding', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    await expect(serverApi('/legal/outstanding')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reads nobody signed in as nobody, and anything else as the failure it is', async () => {
    api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
    expect(await getAccount()).toBeNull();
    api.on('GET /me', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
    await expect(getAccount()).rejects.toMatchObject({ status: 500 });
  });

  it('lists what is outstanding, or nothing', async () => {
    api.on('GET /legal/outstanding', 200, [{ id: 'd-1' }]);
    expect(await getOutstanding()).toEqual([{ id: 'd-1' }]);
    api.on('GET /legal/outstanding', 204);
    expect(await getOutstanding()).toEqual([]);
  });
});
