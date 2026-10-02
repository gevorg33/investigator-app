import { catalogs } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgencyDetails } from '@/lib/api/types';
import { api, apiError } from '@/test/api';
import { employee, invitation, ownAgencyProfile } from '@/test/fixtures';
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

/** The reads the checklist makes, as the API would answer them. */
const answers = (
  over: {
    agency?: Partial<AgencyDetails>;
    dismissed?: boolean;
    version?: number;
    published?: boolean;
    /** Who else is there: nobody, a member, or someone invited (T-093). Invited by default. */
    team?: 'alone' | 'member' | 'invited';
  } = {},
) => {
  const team = over.team ?? 'invited';
  api.on('GET /agencies/current/members', 200, [
    employee({ you: true, roles: ['OWNER'] }),
    ...(team === 'member' ? [employee({ membershipId: 'm-2', you: false })] : []),
  ]);
  api.on(
    'GET /agencies/current/invitations',
    200,
    team === 'invited'
      ? [invitation(), invitation({ id: 'inv-old', status: 'CANCELLED' })]
      : [invitation({ status: 'EXPIRED' })],
  );
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
      [`${en.invite}${en.done}`, '/agency/people#invitations'],
    ]);
  });

  it('counts an empty answer as nobody yet (T-093)', async () => {
    answers({ published: true });
    api.on('GET /agencies/current/members', 204);
    api.on('GET /agencies/current/invitations', 204);
    await checklist();
    expect(screen.getByRole('link', { name: new RegExp(en.invite) })).toHaveTextContent(
      `${en.invite}${en.todo}`,
    );
  });

  it.each([
    ['alone, with only an expired invitation', 'alone', en.todo],
    ['someone else has joined', 'member', en.done],
    ['an invitation is waiting', 'invited', en.done],
  ] as const)(
    'ticks inviting the team only when it has happened: %s (T-093)',
    async (_l, who, state) => {
      answers({ published: true, team: who });
      await checklist();
      const invite = screen.getByRole('link', { name: new RegExp(en.invite) });
      expect(invite).toHaveTextContent(`${en.invite}${state}`);
    },
  );

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
