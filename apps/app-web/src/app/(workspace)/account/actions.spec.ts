import { beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/test/request';
import { chooseActiveRole } from './actions';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const form = (role: string | null) => {
  const f = new FormData();
  if (role !== null) f.set('role', role);
  return f;
};

describe('choosing which role the platform is shown as', () => {
  beforeEach(() => request.reset());

  it.each([['CUSTOMER'], ['INVESTIGATOR']])(
    'narrows to %s for this browser session only, out of reach of scripts',
    async (role) => {
      await chooseActiveRole(form(role));
      expect(request.set).toHaveBeenCalledWith('active_role', role, {
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
      });
      // No maxAge: it ends with the browser session — the API never stores it as a preference.
      expect(request.set.mock.calls[0]![2]).not.toHaveProperty('maxAge');
      expect(request.delete).not.toHaveBeenCalled();
    },
  );

  it.each([['both'], ['STAFF'], [null]])('clears the choice for %s', async (role) => {
    await chooseActiveRole(form(role));
    expect(request.delete).toHaveBeenCalledWith('active_role');
    expect(request.set).not.toHaveBeenCalled();
  });
});
