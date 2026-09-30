import { catalogs } from '@investigator/i18n';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { account } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { EmailSwitch } from './email-switch';
import { EmailsSection } from './emails-section';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const en = catalogs.en.account.emails;
const ACTIVITY = { category: 'activity', channel: 'email' } as const;

beforeEach(() => {
  api.install();
  request.reset();
});

describe('which emails the account gets (T-169)', () => {
  const section = async (enabled: boolean | null, over: Parameters<typeof account>[0] = {}) => {
    api.on('GET /notifications/preferences', 200, {
      preferences: enabled === null ? [] : [{ ...ACTIVITY, enabled }],
    });
    renderIntl(await resolveServer(await EmailsSection({ account: account(over) })));
  };
  const toggle = () => screen.getByRole('switch', { name: en.activity });

  it('says account emails always go, and shows the activity choice as it stands', async () => {
    await section(false);
    const region = screen.getByRole('region', { name: en.title });
    expect(region).toHaveTextContent(en.body);
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toHaveAccessibleDescription(en.activity_body);
    expect(region).not.toHaveTextContent(en.unconfirmed);
  });

  it('reads no stored choice as on, as the API does', async () => {
    await section(null);
    expect(toggle()).toBeChecked();
  });

  it('reads it on when the API sends nothing at all', async () => {
    api.on('GET /notifications/preferences', 204);
    renderIntl(await resolveServer(await EmailsSection({ account: account() })));
    expect(toggle()).toBeChecked();
  });

  it('says an unconfirmed address gets none of them, whatever the switch says', async () => {
    await section(true, { emailVerified: false });
    expect(screen.getByRole('region', { name: en.title })).toHaveTextContent(en.unconfirmed);
  });

  it('turns them off when flipped — the whole row is the target — and shows what was saved', async () => {
    const u = userEvent.setup();
    renderIntl(<EmailSwitch enabled />);
    const release = api.hold('PUT /notifications/preferences', 200, {
      preferences: [{ ...ACTIVITY, enabled: false }],
    });
    await u.click(screen.getByText(en.activity));
    // At once, and not flippable again until the API has answered.
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toBeDisabled();
    release();
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(toggle()).not.toBeChecked();
    expect(api.calls).toEqual([
      expect.objectContaining({
        method: 'PUT',
        path: '/notifications/preferences',
        body: { category: 'activity', channel: 'email', enabled: false },
      }),
    ]);
  });

  it('shows what the API saved, not what was asked', async () => {
    const u = userEvent.setup();
    renderIntl(<EmailSwitch enabled={false} />);
    api.on('PUT /notifications/preferences', 200, {
      preferences: [{ ...ACTIVITY, enabled: false }],
    });
    await u.click(toggle());
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(toggle()).not.toBeChecked();
  });

  it('keeps the new position when the API answers without the choice', async () => {
    const u = userEvent.setup();
    renderIntl(<EmailSwitch enabled={false} />);
    api.on('PUT /notifications/preferences', 204);
    await u.click(toggle());
    await waitFor(() => expect(toggle()).toBeEnabled());
    expect(toggle()).toBeChecked();
  });

  it('goes back and says why when it could not be saved', async () => {
    const u = userEvent.setup();
    renderIntl(<EmailSwitch enabled />);
    api.on(
      'PUT /notifications/preferences',
      400,
      apiError('VALIDATION_FAILED', 'error.validation.failed'),
    );
    await u.click(toggle());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(toggle()).toBeChecked();
    expect(toggle()).toBeEnabled();
  });

  it('goes back when the API cannot be reached', async () => {
    const u = userEvent.setup();
    renderIntl(<EmailSwitch enabled />);
    api.down('PUT /notifications/preferences');
    await u.click(toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.internal);
    expect(toggle()).toBeChecked();
  });
});
