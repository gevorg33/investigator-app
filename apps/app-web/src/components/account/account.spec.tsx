import { catalogs, type Locale } from '@investigator/i18n';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceTimeZone, navigate } from '@/lib/navigate';
import { api, apiError } from '@/test/api';
import { account, legalDocument, session } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import { LegalOutstandingForm } from './legal-outstanding';
import { AccountNotices } from './notices';
import { ProfileSection } from './profile-section';
import { RolesSection } from './roles-section';
import { AccountSection } from './section';
import { SessionsSection } from './sessions-section';
import { TimeZoneForm } from './time-zone-form';

vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('@/lib/navigate', () => ({
  navigate: vi.fn(),
  forgetQuery: vi.fn(),
  deviceTimeZone: vi.fn(),
}));

const en = catalogs.en.account;
const show = async (node: Promise<ReactNode> | ReactNode, locale: Locale = 'en') =>
  renderIntl(await resolveServer(await node), locale);

beforeEach(() => {
  request.reset();
  api.install();
  router.reset();
  vi.mocked(navigate).mockReset();
});

describe('what the account still owes', () => {
  it('is nothing when nothing is owed', async () => {
    expect(await AccountNotices({ unverified: false, outstanding: false })).toBeNull();
  });

  it('points to where each thing is settled, documents first', async () => {
    await show(AccountNotices({ unverified: true, outstanding: true }));
    const notices = screen.getByRole('status');
    expect(notices).toHaveTextContent(catalogs.en.shell.outstanding);
    expect(notices).toHaveTextContent(catalogs.en.shell.unverified);
    expect(
      within(notices)
        .getAllByRole('link', { name: catalogs.en.shell.review })
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/account#legal', '/account#profile']);
  });

  it.each([
    [{ unverified: true, outstanding: false }, ['/account#profile']],
    [{ unverified: false, outstanding: true }, ['/account#legal']],
  ])('shows only what applies (%o)', async (owed, links) => {
    await show(AccountNotices(owed));
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(links);
  });
});

describe('an account section', () => {
  it('is a region named by its title and reachable by its id', () => {
    renderIntl(
      <AccountSection id="legal" title="Documents" body="Read these.">
        <p>inside</p>
      </AccountSection>,
    );
    const region = screen.getByRole('region', { name: 'Documents' });
    expect(region).toHaveAttribute('id', 'legal');
    expect(region).toHaveTextContent('Read these.');
  });

  it('has no description unless given one', () => {
    renderIntl(
      <AccountSection id="x" title="T">
        <p>inside</p>
      </AccountSection>,
    );
    expect(screen.getByRole('region', { name: 'T' }).querySelectorAll('p')).toHaveLength(1);
  });
});

describe('the profile', () => {
  it('shows a confirmed address as confirmed, with nothing to do', async () => {
    await show(ProfileSection({ account: account() }));
    expect(screen.getByText('ana@example.test')).toBeVisible();
    expect(screen.getByText(en.profile.verified)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers a new link for an unconfirmed address, to that address only', async () => {
    api.on('POST /auth/verify-email/resend', 202);
    await show(ProfileSection({ account: account({ emailVerified: false }) }));
    expect(screen.getByText(en.profile.unverified)).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: en.profile.resend }));
    expect(await screen.findByRole('status')).toHaveTextContent(en.profile.resent);
    expect(api.calls[0]).toMatchObject({
      path: '/auth/verify-email/resend',
      body: { email: 'ana@example.test' },
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says so when the new link could not be sent', async () => {
    api.on(
      'POST /auth/verify-email/resend',
      429,
      apiError('RATE_LIMITED', 'error.common.rate_limited'),
    );
    await show(ProfileSection({ account: account({ emailVerified: false }) }));
    await userEvent.setup().click(screen.getByRole('button', { name: en.profile.resend }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.rate_limited,
    );
  });
});

describe('roles', () => {
  it('lists what is held, and adds the other after its documents are accepted', async () => {
    const agreement = legalDocument({
      id: 'doc-ia-1-en',
      type: 'INVESTIGATOR_AGREEMENT',
      title: 'Investigator agreement',
    });
    api.on('GET /legal/required?for=INVESTIGATOR&locale=en', 200, [agreement]);
    api.on('POST /profiles/roles', 201, { role: 'INVESTIGATOR' });
    await show(RolesSection({ account: account(), locale: 'en' }));
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(en.roles.customer);
    // Accepting is part of adding: the browser will not send it unaccepted.
    const add = screen.getByRole('button', {
      name: `${en.roles.add_investigator} — ${en.roles.add_submit}`,
    });
    const user = userEvent.setup();
    await user.click(add);
    expect(api.calls.filter((c) => c.method === 'POST')).toEqual([]);
    await user.click(screen.getByText('Investigator agreement'));
    await user.click(screen.getByRole('checkbox', { name: en.roles.accept }));
    await user.click(add);
    expect(api.calls.at(-1)).toMatchObject({
      method: 'POST',
      path: '/profiles/roles',
      body: { role: 'INVESTIGATOR', acceptedDocumentIds: ['doc-ia-1-en'] },
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('adds a role at once when nothing is published for it', async () => {
    request.cookies.set('locale', 'hy');
    api.on('GET /legal/required?for=CUSTOMER&locale=hy', 204);
    api.on('POST /profiles/roles', 201, { role: 'CUSTOMER' });
    await show(RolesSection({ account: account({ roles: ['INVESTIGATOR'] }), locale: 'hy' }), 'hy');
    const add = screen.getByRole('button', { name: catalogs.hy.account.roles.add_customer });
    expect(add).toHaveAttribute('data-variant', 'outline');
    await userEvent.setup().click(add);
    expect(api.calls.at(-1)!.body).toEqual({ role: 'CUSTOMER', acceptedDocumentIds: [] });
  });

  it('names the document the API says is missing', async () => {
    api.on('GET /legal/required?for=INVESTIGATOR&locale=en', 204);
    api.on(
      'POST /profiles/roles',
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed', {
        details: [
          {
            field: 'acceptedDocumentIds',
            code: 'missing',
            messageKey: 'error.validation.legal.investigator_agreement',
          },
        ],
      }),
    );
    await show(RolesSection({ account: account(), locale: 'en' }));
    await userEvent.setup().click(screen.getByRole('button', { name: en.roles.add_investigator }));
    expect(
      await screen.findByText(catalogs.en.error.validation.legal.investigator_agreement),
    ).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('waits for a confirmed address before offering another role, and asks for nothing meanwhile', async () => {
    await show(RolesSection({ account: account({ emailVerified: false }), locale: 'en' }));
    expect(screen.getByText(en.roles.verify_first)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it.each([
    [null, en.roles.act_both],
    ['CUSTOMER', en.roles.act_customer],
    ['INVESTIGATOR', en.roles.act_investigator],
  ] as const)('with both held, shows the platform as one — now %s', async (activeRole, pressed) => {
    await show(
      RolesSection({
        account: account({ roles: ['CUSTOMER', 'INVESTIGATOR'], activeRole }),
        locale: 'en',
      }),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => [b.getAttribute('name'), b.getAttribute('value')])).toEqual([
      ['role', 'both'],
      ['role', 'CUSTOMER'],
      ['role', 'INVESTIGATOR'],
    ]);
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent(pressed);
    expect(api.calls).toEqual([]);
  });

  it('leads an investigator to their profile, and nobody else', async () => {
    api.on('GET /legal/required?for=CUSTOMER&locale=en', 204);
    api.on('GET /legal/required?for=INVESTIGATOR&locale=en', 204);
    const link = () =>
      screen.queryByRole('link', { name: new RegExp(catalogs.en.investigator.link) });
    const { unmount } = await show(
      RolesSection({ account: account({ roles: ['INVESTIGATOR'] }), locale: 'en' }),
    );
    expect(link()).toHaveAttribute('href', '/account/investigator');
    expect(link()).toHaveTextContent(catalogs.en.investigator.link_body);
    unmount();
    await show(RolesSection({ account: account({ roles: ['CUSTOMER'] }), locale: 'en' }));
    expect(link()).toBeNull();
  });
});

describe('documents to accept again', () => {
  it('accepts exactly the versions shown, then reloads what depends on them', async () => {
    api.on('POST /legal/acceptances', 201, { accepted: 1 });
    renderIntl(<LegalOutstandingForm documents={[legalDocument({ id: 'doc-privacy-4-en' })]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: en.legal.accept }));
    await user.click(screen.getByRole('button', { name: en.legal.submit }));
    expect(api.calls[0]).toMatchObject({
      path: '/legal/acceptances',
      body: { acceptedDocumentIds: ['doc-privacy-4-en'] },
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it('keeps the list when accepting fails', async () => {
    api.on(
      'POST /legal/acceptances',
      409,
      apiError('STATE_CONFLICT', 'error.common.state_conflict'),
    );
    renderIntl(<LegalOutstandingForm documents={[legalDocument()]} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: en.legal.accept }));
    await user.click(screen.getByRole('button', { name: en.legal.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.common.state_conflict,
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('sessions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T02:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  const list = async (sessions: unknown) => {
    api.on('GET /auth/sessions', 200, { sessions });
    await show(SessionsSection({ account: account({ timezone: 'Asia/Yerevan' }), locale: 'en' }));
    return screen.getAllByRole('listitem');
  };

  it('lists this device first, recognisably, in the account’s time zone — and no IP address', async () => {
    const [here, other] = await list([
      session({
        id: 's-2',
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
      }),
      session({ id: 's-1', current: true }),
    ]);
    expect(here).toHaveTextContent(`Chrome on macOS· ${en.sessions.this_device}`);
    expect(here).toHaveTextContent('Last used 2 hours ago');
    // 08:30 UTC is 12:30 in Yerevan.
    expect(here).toHaveTextContent('Signed in on Sep 20, 2026, 12:30 PM');
    expect(other).toHaveTextContent('Safari on iOS');
    expect(other).not.toHaveTextContent(en.sessions.this_device);
    expect(screen.queryByText(/203\.0\.113\.9/)).toBeNull();
  });

  it('names a device it cannot recognise as unknown, rather than guessing', async () => {
    const [item] = await list([session({ userAgent: null })]);
    expect(item).toHaveTextContent(en.sessions.unknown_device);
  });

  it('shows nothing when the API lists nothing', async () => {
    api.on('GET /auth/sessions', 204);
    await show(SessionsSection({ account: account(), locale: 'en' }));
    expect(screen.queryAllByRole('listitem')).toEqual([]);
  });

  it('ends another device’s session at once, and this device’s by signing out', async () => {
    api.on('DELETE /auth/sessions/s-2', 204);
    api.on('POST /auth/logout', 204);
    await list([session({ id: 's-1', current: true }), session({ id: 's-2' })]);
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: en.sessions.sign_out_other }));
    expect(api.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/auth/sessions/s-2' });
    expect(router.refresh).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: en.sessions.sign_out_here }));
    expect(api.calls.at(-1)).toMatchObject({ method: 'POST', path: '/auth/logout' });
    expect(navigate).toHaveBeenCalledWith('/sign-in');
  });

  it('says so when a session could not be ended', async () => {
    api.on('DELETE /auth/sessions/s-2', 404, apiError('NOT_FOUND', 'error.common.not_found'));
    await list([session({ id: 's-2' })]);
    vi.useRealTimers();
    await userEvent.setup().click(screen.getByRole('button', { name: en.sessions.sign_out_other }));
    expect(await screen.findByRole('alert')).toHaveTextContent(catalogs.en.error.common.not_found);
  });
});

describe('the time zone', () => {
  const select = () => screen.getByRole('combobox', { name: en.timezone.choose });

  it('offers the device’s zone when it differs, and saves it in one press', async () => {
    vi.mocked(deviceTimeZone).mockReturnValue('Asia/Yerevan');
    api.on('PATCH /me/preferences', 200, {});
    renderIntl(<TimeZoneForm current="Europe/Moscow" />);
    expect(screen.getByText('Now showing times in Europe/Moscow.')).toBeVisible();
    expect(screen.getByText('Your device is set to Asia/Yerevan.')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use Asia/Yerevan' }));
    expect(api.calls[0]).toMatchObject({
      method: 'PATCH',
      path: '/me/preferences',
      body: { timezone: 'Asia/Yerevan' },
    });
    expect(await screen.findByRole('status')).toHaveTextContent(en.timezone.saved);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('offers nothing extra when the device already agrees, or has no zone to offer', async () => {
    vi.mocked(deviceTimeZone).mockReturnValue('Asia/Yerevan');
    const { unmount } = renderIntl(<TimeZoneForm current="Asia/Yerevan" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    unmount();
    vi.mocked(deviceTimeZone).mockReturnValue(undefined);
    renderIntl(<TimeZoneForm current="Asia/Yerevan" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('lets any zone be chosen from the list, readably named', async () => {
    api.on('PATCH /me/preferences', 200, {});
    renderIntl(<TimeZoneForm current="Asia/Yerevan" />);
    expect(select()).toHaveValue('Asia/Yerevan');
    expect(screen.getByRole('option', { name: 'America/New York' })).toHaveValue(
      'America/New_York',
    );
    const user = userEvent.setup();
    await user.selectOptions(select(), 'America/New_York');
    await user.click(screen.getByRole('button', { name: en.timezone.save }));
    expect(api.calls[0]!.body).toEqual({ timezone: 'America/New_York' });
  });

  it('keeps a saved zone the browser does not list, so it is still shown as chosen', () => {
    renderIntl(<TimeZoneForm current="Etc/Retired_Zone" />);
    expect(select()).toHaveValue('Etc/Retired_Zone');
    expect(screen.getAllByRole('option')[0]).toHaveValue('Etc/Retired_Zone');
  });

  it('says a refused zone is not one it can use', async () => {
    api.on(
      'PATCH /me/preferences',
      422,
      apiError('VALIDATION_FAILED', 'error.common.validation_failed'),
    );
    renderIntl(<TimeZoneForm current="Asia/Yerevan" />);
    await userEvent.setup().click(screen.getByRole('button', { name: en.timezone.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      catalogs.en.error.validation.timezone.invalid,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});
