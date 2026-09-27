import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/test/api';
import { request } from '@/test/request';
import { serverApi } from './server';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

describe('calling the API from the console’s server', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    api.on('GET /me', 200, { id: 'u-1' });
  });

  it('asks as the reviewer, passing on the client’s address the proxy gave it (T-138)', async () => {
    request.cookies.set('investigator_session', 'refresh-token');
    request.headers.set('x-forwarded-for', '203.0.113.7');
    expect(await serverApi('/me')).toEqual({ id: 'u-1' });
    expect(api.calls[0]!.headers).toEqual({
      cookie: 'investigator_session=refresh-token',
      'x-forwarded-for': '203.0.113.7',
    });
  });

  it('invents no address when the proxy gave none, and sends no session it does not have', async () => {
    await serverApi('/me');
    expect(api.calls[0]!.headers).toEqual({});
  });
});
