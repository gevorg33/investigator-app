import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { account } from '@/test/fixtures';
import { request } from '@/test/request';
import { GET } from './route';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const land = (query: string) =>
  GET(new NextRequest(new URL(`/session/start${query}`, 'https://app.example.test')));

describe('landing after signing in', () => {
  beforeEach(() => {
    request.reset();
    api.install();
    request.cookies.set('investigator_session', 'tok');
  });

  it('restores the language saved on the account, and goes on to the page asked for', async () => {
    api.on('GET /me', 200, account({ locale: 'hy' }));
    const res = await land('?next=%2Fmissions%3Ftab%3Dopen');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.example.test/missions?tab=open');
    expect(res.cookies.get('locale')).toMatchObject({
      value: 'hy',
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    });
    // A role chosen in a previous session does not carry into this one.
    expect(res.headers.get('set-cookie')).toMatch(
      /active_role=; Path=\/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/,
    );
  });

  it.each([['https://evil.test'], ['//evil.test'], [undefined]])(
    'goes home rather than to %s',
    async (next) => {
      api.on('GET /me', 200, account({ locale: 'en' }));
      const res = await land(next === undefined ? '' : `?next=${encodeURIComponent(next)}`);
      expect(res.headers.get('location')).toBe('https://app.example.test/');
    },
  );

  it('leaves the language alone when the account’s is not one the app speaks', async () => {
    api.on('GET /me', 200, account({ locale: 'de' }));
    const res = await land('');
    expect(res.cookies.get('locale')).toBeUndefined();
  });

  it('sends back to sign-in when there is no session after all', async () => {
    api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
    const res = await land('?next=%2Faccount');
    expect(res.headers.get('location')).toBe('https://app.example.test/sign-in');
    expect(res.cookies.getAll()).toEqual([]);
  });
});
