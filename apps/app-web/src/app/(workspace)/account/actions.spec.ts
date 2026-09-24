import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/test/request';
import { chooseLocale } from './actions';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const form = (locale: string | null) => {
  const f = new FormData();
  if (locale !== null) f.set('locale', locale);
  return f;
};

describe('recording a language choice', () => {
  beforeEach(() => request.reset());

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
  });

  it.each([['de'], ['<script>'], [null]])(
    'changes nothing for %s — a form can be edited',
    async (value) => {
      await chooseLocale(form(value));
      expect(request.set).not.toHaveBeenCalled();
    },
  );
});
