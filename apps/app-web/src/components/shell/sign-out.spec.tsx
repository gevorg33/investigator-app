import { catalogs } from '@investigator/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '@/lib/navigate';
import { api } from '@/test/api';
import { renderIntl } from '@/test/intl';
import { SignOut } from './sign-out';

vi.mock('@/lib/navigate', () => ({ navigate: vi.fn() }));

/** Signing out from the sidebar or the Account page (T-062): the API ends it, then sign-in. */
describe('signing out', () => {
  beforeEach(() => {
    api.install();
    vi.mocked(navigate).mockReset();
  });

  it('ends this device’s session through the API, then loads sign-in afresh', async () => {
    api.on('POST /auth/logout', 204);
    renderIntl(<SignOut label="Sign out" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/sign-in'));
    expect(api.calls.map((c) => [c.method, c.path])).toEqual([['POST', '/auth/logout']]);
  });

  it('says so, and stays, when the API cannot be reached', async () => {
    api.down('POST /auth/logout');
    renderIntl(<SignOut label="Sign out" />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(navigate).not.toHaveBeenCalled();
  });
});
