import { catalogs } from '@investigator/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SWITCHED_KEY } from '@/components/workspace/workspace-scope';
import { forgetQuery, navigate } from '@/lib/navigate';
import { api, apiError } from '@/test/api';
import { renderIntl } from '@/test/intl';
import { AcceptInvitation } from './accept-invitation';

vi.mock('@/lib/navigate', () => ({ navigate: vi.fn(), forgetQuery: vi.fn() }));

const en = catalogs.en;

beforeEach(() => {
  api.install();
  vi.mocked(navigate).mockReset();
  vi.mocked(forgetQuery).mockReset();
});

describe('accepting an invitation (T-158)', () => {
  const inv = en.auth.invitation;
  const press = () => userEvent.setup().click(screen.getByRole('button', { name: inv.submit }));

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('joins on a press, never on load, then moves into the agency and loads Home', async () => {
    api.on('POST /invitations/accept', 200, { workspaceId: 'agency-7', name: 'Ararat' });
    api.on('POST /workspaces/agency-7/activate', 204);
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
    // The token leaves the address bar, and nothing is spent until the reader decides.
    expect(forgetQuery).toHaveBeenCalledTimes(1);
    expect(api.calls).toEqual([]);
    expect(screen.getByText(/ana@example\.test/)).toBeVisible();

    await press();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    expect(api.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/invitations/accept', { token: 'tok-1' }],
      ['POST', '/workspaces/agency-7/activate', undefined],
    ]);
    // Home then says "Now working in …", as after creating an agency.
    expect(sessionStorage.getItem(SWITCHED_KEY)).toBe('agency-7');
  });

  it('says one thing for every invitation it cannot use, naming the account signed in', async () => {
    api.on('POST /invitations/accept', 404, apiError('NOT_FOUND', 'error.common.not_found'));
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
    await press();
    expect(
      await screen.findByText(inv.refused.not_found.replace('{email}', 'ana@example.test')),
    ).toBeVisible();
    // Nothing left to press: another try would answer the same.
    expect(screen.queryByRole('button', { name: inv.submit })).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('sends someone already a member to Home, where the agency is in the menu', async () => {
    api.on(
      'POST /invitations/accept',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict', {
        details: [
          {
            field: 'token',
            code: 'MEMBER',
            messageKey: 'error.validation.employees.already_member',
          },
        ],
      }),
    );
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
    await press();
    expect(await screen.findByText(inv.refused.member)).toBeVisible();
    expect(screen.getByRole('link', { name: inv.home })).toHaveAttribute('href', '/');
  });

  it('tells a suspended member to ask the agency, and offers nothing to press', async () => {
    api.on(
      'POST /invitations/accept',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict', {
        details: [
          { field: 'token', code: 'SUSPENDED', messageKey: 'error.validation.employees.suspended' },
        ],
      }),
    );
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />, 'ru');
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: catalogs.ru.auth.invitation.submit }));
    expect(await screen.findByText(catalogs.ru.auth.invitation.refused.suspended)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks an account that is not active yet to confirm its address first', async () => {
    api.on('POST /invitations/accept', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
    await press();
    expect(await screen.findByText(inv.refused.unconfirmed)).toBeVisible();
    expect(screen.getByRole('link', { name: inv.confirm_link })).toHaveAttribute(
      'href',
      '/check-email',
    );
    // Once confirmed, the same press works.
    expect(screen.getByRole('button', { name: inv.submit })).toBeEnabled();
  });

  it('leaves the button for a failure worth trying again, with its reference', async () => {
    api.on(
      'POST /invitations/accept',
      500,
      apiError('INTERNAL_ERROR', 'error.common.internal', { correlationId: 'corr-9' }),
    );
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
    await press();
    expect(await screen.findByText(en.error.common.internal)).toBeVisible();
    expect(screen.getByText(/corr-9/)).toBeVisible();
    expect(screen.getByRole('button', { name: inv.submit })).toBeEnabled();
  });

  it('treats a conflict it does not know as any other failure', async () => {
    api.on(
      'POST /invitations/accept',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict'),
    );
    renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
    await press();
    expect(await screen.findByText(en.error.common.state_conflict)).toBeVisible();
    expect(screen.getByRole('button', { name: inv.submit })).toBeEnabled();
  });

  it('still goes on when the confirmation cannot be stored', async () => {
    api.on('POST /invitations/accept', 200, { workspaceId: 'agency-7', name: 'Ararat' });
    api.on('POST /workspaces/agency-7/activate', 204);
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    try {
      renderIntl(<AcceptInvitation token="tok-1" email="ana@example.test" />);
      await press();
      await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'));
    } finally {
      set.mockRestore();
    }
  });
});
