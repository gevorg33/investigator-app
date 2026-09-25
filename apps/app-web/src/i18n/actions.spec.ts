import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { request } from '@/test/request';
import { chooseLocale } from './actions';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const form = (locale: string | null) => {
  const f = new FormData();
  if (locale !== null) f.set('locale', locale);
  return f;
};

describe('recording a language choice', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps it a year, on this host only, out of reach of scripts', async () => {
    await chooseLocale(form('hy'));
    expect(request.set).toHaveBeenCalledWith('locale', 'hy', {
      path: '/',
      maxAge: 31_536_000,
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    });
    // Host-only: no domain, so the cookie never reaches the marketing site or another subdomain.
    expect(request.set.mock.calls[0]![2]).not.toHaveProperty('domain');
    // Signed out, there is no account to save it to.
    expect(api.calls).toEqual([]);
  });

  it('saves it to the account when signed in, so the next sign-in restores it', async () => {
    request.cookies.set('investigator_session', 'tok');
    api.on('PATCH /me/preferences', 200, { locale: 'ru' });
    await chooseLocale(form('ru'));
    expect(request.set).toHaveBeenCalledWith('locale', 'ru', expect.anything());
    expect(api.calls).toMatchObject([
      {
        method: 'PATCH',
        path: '/me/preferences',
        body: { locale: 'ru' },
        headers: { cookie: 'investigator_session=tok' },
      },
    ]);
  });

  it('still changes the page’s language when the session has ended, and says nothing of it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    request.cookies.set('investigator_session', 'expired');
    api.on('PATCH /me/preferences', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
    await chooseLocale(form('hy'));
    expect(request.set).toHaveBeenCalledWith('locale', 'hy', expect.anything());
    expect(error).not.toHaveBeenCalled();
  });

  it('reports a failure to save, without undoing the choice', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    request.cookies.set('investigator_session', 'tok');
    api.on('PATCH /me/preferences', 500, apiError('INTERNAL_ERROR', 'error.common.internal'));
    await chooseLocale(form('ru'));
    expect(request.set).toHaveBeenCalledWith('locale', 'ru', expect.anything());
    expect(error).toHaveBeenCalledWith(
      '[i18n] saving the language to the account failed',
      expect.objectContaining({ status: 500 }),
    );
  });

  it.each([['de'], ['<script>'], [null]])(
    'changes nothing for %s — a form can be edited',
    async (value) => {
      request.cookies.set('investigator_session', 'tok');
      await chooseLocale(form(value));
      expect(request.set).not.toHaveBeenCalled();
      expect(api.calls).toEqual([]);
    },
  );
});
