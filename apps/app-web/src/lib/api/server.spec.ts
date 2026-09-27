import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { request } from '@/test/request';
import { getAccount, getOutstanding, getWorkspaces, serverApi } from './server';

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

  it('passes on the client’s address the proxy gave it, and invents none (T-138)', async () => {
    // Caddy writes X-Forwarded-For; the API trusts this server as the next hop and reads the
    // client from it. Without it, every server-side read carried this server's address.
    request.headers.set('x-forwarded-for', '203.0.113.7');
    api.on('GET /me', 200, { id: 'u-1' });
    await serverApi('/me');
    expect(api.calls[0]!.headers['x-forwarded-for']).toBe('203.0.113.7');
    request.reset();
    api.install();
    api.on('GET /me', 200, { id: 'u-1' });
    await serverApi('/me');
    expect(api.calls[0]!.headers).not.toHaveProperty('x-forwarded-for');
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

  describe('the reader’s workspaces (T-164)', () => {
    const me = (emailVerified: boolean) => api.on('GET /me', 200, { id: 'u-1', emailVerified });

    it('are listed for a confirmed account', async () => {
      me(true);
      api.on('GET /workspaces', 200, [{ id: 'ws-1', current: true }]);
      expect(await getWorkspaces()).toEqual([{ id: 'ws-1', current: true }]);
    });

    it('are not asked for while the address is unconfirmed, which the API would refuse', async () => {
      me(false);
      api.on('GET /workspaces', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      expect(await getWorkspaces()).toEqual([]);
      expect(api.calls.map((c) => c.path)).toEqual(['/me']);
    });

    it('are none with nobody signed in', async () => {
      api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
      expect(await getWorkspaces()).toEqual([]);
    });
  });

  it('lists what is outstanding, or nothing', async () => {
    api.on('GET /legal/outstanding', 200, [{ id: 'd-1' }]);
    expect(await getOutstanding()).toEqual([{ id: 'd-1' }]);
    api.on('GET /legal/outstanding', 204);
    expect(await getOutstanding()).toEqual([]);
  });
});
