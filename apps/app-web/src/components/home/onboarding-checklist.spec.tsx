import { catalogs } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgencyDetails } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { ownAgencyProfile } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { resolveServer } from '@/test/server';
import { AgencyChecklist } from './agency-checklist';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

const en = catalogs.en.home.checklist;

const details = (over: Partial<AgencyDetails> = {}): AgencyDetails => ({
  id: 'ws-ararat',
  name: 'Ararat Investigations',
  status: 'ACTIVE',
  countryCode: 'AM',
  businessEmail: 'office@ararat.test',
  timezone: 'Asia/Yerevan',
  currency: 'AMD',
  missing: [],
  version: 1,
  mayChange: true,
  ...over,
});

/** The three reads the checklist makes, as the API would answer them. */
const answers = (
  over: {
    agency?: Partial<AgencyDetails>;
    dismissed?: boolean;
    version?: number;
    published?: boolean;
  } = {},
) => {
  api.on('GET /agencies/current', 200, details(over.agency));
  api.on('GET /agencies/current/settings', 200, {
    general: {
      version: over.version ?? 0,
      values: { onboardingDismissed: over.dismissed ?? false },
    },
    branding: { version: 0, values: {}, derived: {} },
  });
  api.on(
    'GET /agencies/current/profile',
    200,
    ownAgencyProfile({ publishedAt: over.published === true ? '2026-09-27T10:00:00.000Z' : null }),
  );
};

const checklist = async () => renderIntl(await resolveServer(await AgencyChecklist()));

beforeEach(() => {
  api.install();
  router.reset();
});

describe('the agency onboarding checklist (T-149)', () => {
  it('lists what is left, each a link to where it is done, ticked from what the API says', async () => {
    answers({ agency: { status: 'CREATING', missing: ['currency'] }, published: true });
    await checklist();
    const region = screen.getByRole('region', { name: 'Set up Ararat Investigations' });
    expect(region).toHaveTextContent(en.body);
    const links = within(region)
      .getAllByRole('link')
      .map((a) => [a.textContent, a.getAttribute('href')]);
    expect(links).toEqual([
      [`${en.details}${en.todo}`, '/agencies/current'],
      [`${en.profile}${en.done}`, '/agency'],
    ]);
  });

  it('says so when everything is done, and still offers to hide itself', async () => {
    answers({ published: true });
    await checklist();
    expect(screen.getByText(en.complete)).toBeVisible();
    expect(screen.queryByText(en.body)).toBeNull();
    expect(screen.getByRole('button', { name: en.dismiss })).toBeEnabled();
  });

  it('is for the owner only: nobody else is asked for any of it', async () => {
    api.on('GET /agencies/current', 200, details({ mayChange: false }));
    const { container } = await checklist();
    expect(container).toBeEmptyDOMElement();
    expect(api.calls.map((c) => c.path)).toEqual(['/agencies/current']);
  });

  it('stays hidden once dismissed', async () => {
    answers({ dismissed: true });
    const { container } = await checklist();
    expect(container).toBeEmptyDOMElement();
  });

  it('hides itself for the workspace — saved to its settings, against the version read', async () => {
    answers({ version: 3 });
    api.on('PATCH /agencies/current/settings/general', 200, {
      version: 4,
      values: { onboardingDismissed: true },
      derived: {},
    });
    await checklist();
    await userEvent.setup().click(screen.getByRole('button', { name: en.dismiss }));
    expect(api.calls.at(-1)).toMatchObject({
      method: 'PATCH',
      path: '/agencies/current/settings/general',
      body: { version: 3, values: { onboardingDismissed: true } },
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('says why it could not hide itself — someone else changed the settings first', async () => {
    answers();
    api.on(
      'PATCH /agencies/current/settings/general',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict'),
    );
    await checklist();
    await userEvent.setup().click(screen.getByRole('button', { name: en.dismiss }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.state_conflict,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('answers nothing when the agency cannot be read', async () => {
    api.on('GET /agencies/current', 204);
    const { container } = await checklist();
    expect(container).toBeEmptyDOMElement();
  });
});
