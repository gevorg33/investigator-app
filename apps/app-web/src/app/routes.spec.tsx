import { catalogs } from '@investigator/i18n';
import { colors } from '@investigator/ui-tokens';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';
import { I18nProvider } from '@/i18n/provider';
import { api, apiError } from '@/test/api';
import { SWITCHED_KEY } from '@/components/workspace/workspace-scope';
import {
  account,
  agencyWorkspace,
  application,
  legalDocument,
  ownProfile,
  serviceArea,
  session,
  workspace,
} from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { NotFound, Redirected } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import InvestigatorPage, {
  generateMetadata as investigatorMeta,
} from './(workspace)/account/investigator/page';
import AccountPage, { generateMetadata as accountMeta } from './(workspace)/account/page';
import Missing from './(workspace)/[...missing]/page';
import WorkspaceLayout from './(workspace)/layout';
import InvestigatorNotFound from './(workspace)/missions/investigators/[id]/not-found';
import MissionNotFound from './(workspace)/missions/[id]/not-found';
import WorkspaceNotFound from './(workspace)/not-found';
import MessagesPage, { generateMetadata as messagesMeta } from './(workspace)/messages/page';
import MissionsPage, { generateMetadata as missionsMeta } from './(workspace)/missions/page';
import HomePage from './(workspace)/page';
import RootLayout, { CLIENT_NAMESPACES, generateMetadata, viewport } from './layout';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);

type Html = ReactElement<{
  lang: string;
  children: ReactElement<{ children: ReactElement<{ locale: string; messages: object }> }>;
}>;

describe('the application routes', () => {
  beforeEach(() => {
    request.reset();
    api.install();
  });

  it('is never indexed — by metadata and by header, so neither can be forgotten alone', async () => {
    expect((await generateMetadata()).robots).toEqual({ index: false, follow: false });
    const headers = await nextConfig.headers!();
    expect(headers).toEqual([
      { source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]);
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
  });

  it('reaches under the notch, and colours the browser chrome from the surface token', () => {
    expect(viewport.viewportFit).toBe('cover');
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: light)', color: colors.light.surface },
      { media: '(prefers-color-scheme: dark)', color: colors.dark.surface },
    ]);
  });

  it('declares the reader’s language, titles in it, and sends the browser only what it renders', async () => {
    request.acceptLanguage = 'ru-RU,ru;q=0.9';
    const html = (await RootLayout({ children: 'x' })) as Html;
    expect(html.type).toBe('html');
    expect(html.props.lang).toBe('ru');
    const provider = html.props.children.props.children;
    expect(provider.props.locale).toBe('ru');
    // Client components translate navigation, the browse, the investigator profile, the workspace
    // switcher and agency onboarding, the assistant, the auth and account forms, legal text and
    // errors.
    expect(CLIENT_NAMESPACES).toEqual([
      'nav',
      'missions',
      'investigator',
      'workspace',
      'assistant',
      'auth',
      'account',
      'legal',
      'error',
    ]);
    expect(provider.props.messages).toEqual(
      Object.fromEntries(CLIENT_NAMESPACES.map((ns) => [ns, catalogs.ru[ns]])),
    );
    expect((await generateMetadata()).title).toEqual({
      default: 'Investigator',
      template: '%s · Investigator',
    });
  });

  it('frames every workspace route with the shell, and what the account still owes', async () => {
    request.cookies.set('investigator_session', 'tok');
    api.on('GET /me', 200, account({ emailVerified: false }));
    api.on('GET /legal/outstanding', 200, [legalDocument()]);
    // Nothing listed: no workspace to name, and nothing to switch between.
    api.on('GET /workspaces', 204);
    const tree = await resolveServer(await WorkspaceLayout({ children: 'inside' }));
    render(
      <I18nProvider
        locale="en"
        messages={{ nav: catalogs.en.nav, assistant: catalogs.en.assistant }}
      >
        {tree}
      </I18nProvider>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('inside');
    expect(screen.getByRole('status')).toHaveTextContent(catalogs.en.shell.outstanding);
    expect(screen.getByRole('status')).toHaveTextContent(catalogs.en.shell.unverified);
    expect(screen.queryByRole('button', { name: /^Switch workspace/ })).toBeNull();
  });

  it('owes nothing, shows nothing', async () => {
    api.on('GET /me', 200, account());
    api.on('GET /legal/outstanding', 200, []);
    api.on('GET /workspaces', 200, [workspace()]);
    render(
      <I18nProvider
        locale="en"
        messages={{ nav: catalogs.en.nav, assistant: catalogs.en.assistant }}
      >
        {await resolveServer(await WorkspaceLayout({ children: 'inside' }))}
      </I18nProvider>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('inside');
    expect(screen.queryByRole('status')).toBeNull();
    // One workspace: nothing to switch between, so no switcher.
    expect(screen.queryByRole('button', { name: /^Switch workspace/ })).toBeNull();
  });

  describe('the workspace a page is in (T-092)', () => {
    const inAgency = async () => {
      api.on('GET /me', 200, account());
      api.on('GET /legal/outstanding', 200, []);
      api.on('GET /workspaces', 200, [
        workspace({ current: false }),
        agencyWorkspace({ current: true }),
      ]);
      renderIntl(await resolveServer(await WorkspaceLayout({ children: 'inside' })));
    };

    it('offers the switcher in the sidebar and above the content on a phone', async () => {
      await inAgency();
      const [menu, sheet] = screen.getAllByRole('button', {
        name: 'Switch workspace, now Ararat Investigations',
      });
      expect(menu!.closest('aside')).toHaveClass('hidden', 'md:flex');
      expect(sheet!.closest('main')).not.toBeNull();
      expect(sheet!.parentElement!.parentElement).toHaveClass('md:hidden');
    });

    it('names it on every call from the page, and confirms a switch that landed here', async () => {
      sessionStorage.setItem(SWITCHED_KEY, 'ws-ararat');
      await inAgency();
      expect(await screen.findByRole('status')).toHaveTextContent(
        'Now working in Ararat Investigations.',
      );
      api.on('GET /ai/sessions?limit=1', 200, {
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false },
      });
      await userEvent.click(screen.getAllByRole('button', { name: 'Assistant' })[0]!);
      await screen.findByRole('heading', { name: catalogs.en.assistant.empty.title });
      const fromPage = api.calls.filter((c) => c.origin === '');
      expect(fromPage.length).toBeGreaterThan(0);
      for (const call of fromPage) expect(call.headers['x-workspace']).toBe('ws-ararat');
    });
  });

  describe('the assistant, beside every workspace page (T-056)', () => {
    const open = async (over: Parameters<typeof account>[0]) => {
      api.on('GET /me', 200, account(over));
      api.on('GET /legal/outstanding', 200, []);
      api.on('GET /workspaces', 200, []);
      api.on('GET /ai/sessions?limit=1', 200, {
        items: [],
        pageInfo: { nextCursor: null, hasNextPage: false },
      });
      renderIntl(await resolveServer(await WorkspaceLayout({ children: 'inside' })));
      await userEvent.click(screen.getAllByRole('button', { name: 'Assistant' })[0]!);
      return screen.findByRole('heading', { name: catalogs.en.assistant.empty.title });
    };

    it('offers a customer what a customer asks, and says nothing about roles it was not told', async () => {
      await open({ roles: ['CUSTOMER'] });
      expect(
        screen.getByRole('button', { name: catalogs.en.assistant.empty.customer.quote }),
      ).toBeInTheDocument();
      const ask = api.calls.find((c) => c.path === '/ai/sessions?limit=1')!;
      expect(ask.headers['x-active-role']).toBeUndefined();
    });

    it('offers an account with no role yet only what the public policies answer, and where to add one', async () => {
      await open({ roles: [] });
      expect(
        screen.getByRole('button', { name: catalogs.en.assistant.empty.public.training }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: catalogs.en.assistant.empty.customer.quote }),
      ).toBeNull();
      expect(
        screen.getByRole('link', { name: catalogs.en.assistant.empty.no_role_link }),
      ).toHaveAttribute('href', '/account#roles');
    });

    it('offers an investigator what an investigator asks', async () => {
      await open({ roles: ['CUSTOMER', 'INVESTIGATOR'] });
      expect(
        screen.getByRole('button', { name: catalogs.en.assistant.empty.investigator.paid }),
      ).toBeInTheDocument();
    });

    it('talks to an investigator who chose to act as a customer as a customer, and tells the API so', async () => {
      await open({ roles: ['CUSTOMER', 'INVESTIGATOR'], activeRole: 'CUSTOMER' });
      expect(
        screen.getByRole('button', { name: catalogs.en.assistant.empty.customer.mission }),
      ).toBeInTheDocument();
      const ask = api.calls.find((c) => c.path === '/ai/sessions?limit=1')!;
      expect(ask.headers['x-active-role']).toBe('CUSTOMER');
    });
  });

  it.each([
    ['/missions?tab=open', '/sign-in?next=%2Fmissions%3Ftab%3Dopen'],
    [null, '/sign-in?next=%2F'],
  ])('sends a reader with no session to sign in, and back to %s after', async (path, to) => {
    if (path !== null) request.headers.set('x-pathname', path);
    api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated'));
    await expect(WorkspaceLayout({ children: 'inside' })).rejects.toEqual(new Redirected(to));
    expect(api.calls.map((c) => c.path)).toEqual(['/me']);
  });

  it.each([
    ['Home', HomePage, undefined, 'Nothing needs you yet'],
    ['Messages', MessagesPage, messagesMeta, 'No conversations yet'],
  ])('%s says what it is and what will appear there', async (title, Page, meta, empty) => {
    render(await resolveServer(await Page()));
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: empty })).toBeInTheDocument();
    if (meta !== undefined) expect((await meta()).title).toBe(title);
  });

  it('renders every page in the reader’s chosen language', async () => {
    request.cookies.set('locale', 'hy');
    api.on('GET /me', 200, account());
    api.on('GET /missions/me', 200, []);
    render(await resolveServer(await MissionsPage({ searchParams: Promise.resolve({}) })));
    expect(
      screen.getByRole('heading', { level: 1, name: catalogs.hy.nav.missions }),
    ).toBeInTheDocument();
    expect(screen.getByText(catalogs.hy.missions.own.empty.body)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: catalogs.hy.missions.views.find })).toBeInTheDocument();
    expect((await missionsMeta()).title).toBe(catalogs.hy.nav.missions);
  });

  describe('a page that is not there (T-151)', () => {
    const links = () =>
      screen.getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')]);

    it('says so in the reader’s language, with a way Home', async () => {
      request.cookies.set('locale', 'ru');
      render(await resolveServer(<WorkspaceNotFound />));
      const ru = catalogs.ru.not_found;
      expect(screen.getByRole('heading', { level: 1, name: ru.title })).toBeInTheDocument();
      expect(screen.getByText(ru.body)).toBeInTheDocument();
      expect(links()).toEqual([[ru.home, '/']]);
    });

    it('leads back to the list the page belongs to, when the route knows it', async () => {
      const en = catalogs.en;
      render(await resolveServer(<MissionNotFound />));
      expect(links()).toEqual([
        [en.not_found.missions, '/missions'],
        [en.not_found.home, '/'],
      ]);
    });

    it('reads the same for an unpublished profile as for a missing one: there is one page', async () => {
      const en = catalogs.en;
      render(await resolveServer(<InvestigatorNotFound />));
      expect(screen.getByText(en.not_found.body)).toBeInTheDocument();
      expect(links()).toEqual([
        [en.missions.profile.back, '/missions/investigators'],
        [en.not_found.home, '/'],
      ]);
    });

    it('sends an address nothing answers to the workspace’s page, not Next’s', () => {
      expect(() => Missing()).toThrow(NotFound);
    });

    it('keeps the shell around it', async () => {
      request.cookies.set('investigator_session', 'tok');
      api.on('GET /me', 200, account());
      api.on('GET /legal/outstanding', 200, []);
      api.on('GET /workspaces', 200, [workspace()]);
      renderIntl(await resolveServer(await WorkspaceLayout({ children: <WorkspaceNotFound /> })));
      expect(
        screen.getByRole('heading', { level: 1, name: catalogs.en.not_found.title }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByRole('link', { name: catalogs.en.nav.missions }).length,
      ).toBeGreaterThan(0);
    });
  });

  describe('the missions page', () => {
    const missions = async (over: Parameters<typeof account>[0]) => {
      api.on('GET /me', 200, account(over));
      return renderIntl(
        await resolveServer(
          await MissionsPage({ searchParams: Promise.resolve({ sort: 'deadline' }) }),
        ),
      );
    };

    it('lists a customer’s own missions, with a way to start one (T-119)', async () => {
      api.on('GET /missions/me', 200, []);
      await missions({ roles: ['CUSTOMER'] });
      expect(screen.getByRole('heading', { level: 1, name: 'Missions' })).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'No missions yet' }),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'New mission' })).toHaveAttribute(
        'href',
        '/missions/new',
      );
      expect((await missionsMeta()).title).toBe('Missions');
      expect(api.calls.map((c) => c.path)).toEqual(['/me', '/missions/me']);
    });

    it('says what will appear there to someone who is neither customer nor investigator', async () => {
      await missions({ roles: ['STAFF'] });
      expect(screen.getByText(catalogs.en.missions.empty.body)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'New mission' })).toBeNull();
      expect(api.calls.map((c) => c.path)).toEqual(['/me']);
    });

    it('shows an investigator the open missions, with the filters from the address', async () => {
      api.on('POST /search/missions', 403, apiError('FORBIDDEN', 'error.auth.forbidden'));
      await missions({ roles: ['CUSTOMER', 'INVESTIGATOR'] });
      expect(api.calls.at(-1)).toMatchObject({
        path: '/search/missions',
        body: { sort: 'deadline' },
      });
      expect(
        screen.getByRole('heading', { name: catalogs.en.missions.browse.unavailable.title }),
      ).toBeInTheDocument();
    });

    it('keeps to the customer’s view for someone showing the platform as a customer', async () => {
      api.on('GET /missions/me', 200, []);
      await missions({ roles: ['CUSTOMER', 'INVESTIGATOR'], activeRole: 'CUSTOMER' });
      expect(
        screen.getByRole('heading', { level: 2, name: 'No missions yet' }),
      ).toBeInTheDocument();
      expect(api.calls.map((c) => c.path)).toEqual(['/me', '/missions/me']);
    });
  });

  describe('the account page', () => {
    const signedIn = (outstanding: unknown[]) => {
      api.on('GET /me', 200, account({ timezone: 'Asia/Yerevan' }));
      api.on('GET /legal/outstanding', 200, outstanding);
      api.on('GET /legal/required?for=INVESTIGATOR&locale=en', 200, []);
      api.on('GET /auth/sessions', 200, { sessions: [session({ current: true })] });
      api.on('GET /workspaces', 200, [workspace(), agencyWorkspace()]);
    };
    const sections = () => screen.getAllByRole('region').map((r) => r.id);

    it('puts documents to accept first, then who, roles, agencies, language, time zone and sessions', async () => {
      signedIn([legalDocument()]);
      renderIntl(await resolveServer(await AccountPage()));
      expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
      expect(sections()).toEqual([
        'legal',
        'profile',
        'roles',
        'agencies',
        '',
        'timezone',
        'sessions',
      ]);
      const agencies = screen.getByRole('region', { name: catalogs.en.workspace.agencies.title });
      expect(agencies).toHaveTextContent(catalogs.en.workspace.agencies.body);
      expect(
        within(agencies).getByRole('link', { name: catalogs.en.workspace.create }),
      ).toHaveAttribute('href', '/agencies/new');
      expect(screen.getByRole('region', { name: 'Language' })).toBeVisible();
      expect(screen.getByText('Now showing times in Asia/Yerevan.')).toBeVisible();
      expect((await accountMeta()).title).toBe('Account');
    });

    it('asks for a confirmed address before an agency can be created', async () => {
      signedIn([]);
      // No workspaces listed: nothing to lead to, and nothing breaks.
      api.on('GET /workspaces', 204);
      api.on('GET /me', 200, account({ timezone: 'Asia/Yerevan', emailVerified: false }));
      renderIntl(await resolveServer(await AccountPage()));
      const agencies = screen.getByRole('region', { name: catalogs.en.workspace.agencies.title });
      expect(agencies).toHaveTextContent(catalogs.en.account.roles.verify_first);
      expect(within(agencies).queryByRole('link')).toBeNull();
    });

    it('leads to the agency’s details from inside an agency, and only there (T-150)', async () => {
      signedIn([]);
      const details = catalogs.en.workspace.agency_details.link;
      const { unmount } = renderIntl(await resolveServer(await AccountPage()));
      expect(screen.queryByRole('link', { name: details })).toBeNull();
      unmount();

      api.on('GET /workspaces', 200, [
        workspace({ current: false }),
        agencyWorkspace({ current: true }),
      ]);
      renderIntl(await resolveServer(await AccountPage()));
      expect(screen.getByRole('link', { name: details })).toHaveAttribute(
        'href',
        '/agencies/current',
      );
    });

    it('has no documents section when nothing is outstanding', async () => {
      signedIn([]);
      renderIntl(await resolveServer(await AccountPage()));
      expect(sections()).not.toContain('legal');
    });
  });
  describe('the investigator profile page (T-123)', () => {
    const investigator = (over: { areas?: number; empty?: boolean } = {}) => {
      api.on('GET /me', 200, account({ roles: ['CUSTOMER', 'INVESTIGATOR'] }));
      const reply = (route: string, body: unknown) =>
        over.empty === true ? api.on(route, 204) : api.on(route, 200, body);
      api.on('GET /profiles/investigator/me', 200, ownProfile({ verificationStatus: 'PENDING' }));
      api.on('GET /profiles/investigator/me/preview', 200, ownProfile());
      reply('GET /service-areas/me', over.areas === 0 ? [] : [serviceArea()]);
      reply('GET /verification/me/requests', [application()]);
      reply('GET /taxonomy?locale=en', [
        {
          id: 'corp',
          label: null,
          slug: 'corporate',
          children: [
            {
              id: '5f51f336-5c7a-442a-909f-8d54d5abf81b',
              label: 'Due diligence',
              slug: 'due-diligence',
              children: [],
            },
          ],
        },
      ]);
    };
    const en = catalogs.en.investigator;

    it('shows where the profile stands, then each part of it, in order', async () => {
      investigator();
      renderIntl(await resolveServer(await InvestigatorPage()));
      expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeVisible();
      expect(screen.getByText(en.intro)).toBeVisible();
      const sections = screen.getAllByRole('region').filter((r) => r.id !== '');
      expect(sections.map((r) => r.id)).toEqual([
        'status',
        'details',
        'languages',
        'specialties',
        'availability',
        'areas',
        'verification',
      ]);
      expect(within(sections[0]!).getByText(en.verification_status.PENDING)).toBeVisible();
      // Under review: the name it was checked against is shown, not offered for change.
      expect(screen.getByRole('textbox', { name: en.details.name })).toHaveAttribute('readonly');
      // A category with no label in this language is offered by its slug.
      expect(screen.getByRole('option', { name: 'corporate' })).toBeInTheDocument();
      expect(screen.getByText('Yerevan', { selector: 'span' })).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent(en.verification.open);
      expect((await investigatorMeta()).title).toBe(en.title);
    });

    it('treats a route with nothing to say as nothing', async () => {
      investigator({ empty: true });
      renderIntl(await resolveServer(await InvestigatorPage()));
      expect(screen.getByText(en.areas.empty)).toBeVisible();
      expect(screen.getByText(en.verification.none)).toBeVisible();
      expect(screen.getByText(en.specialties.none)).toBeInTheDocument();
    });

    it.each([
      ['someone without the role', () => api.on('GET /me', 200, account())],
      [
        'someone signed out',
        () => api.on('GET /me', 401, apiError('UNAUTHENTICATED', 'error.auth.unauthenticated')),
      ],
    ])('sends %s to Account, where the role is added', async (_, as) => {
      as();
      await expect(InvestigatorPage()).rejects.toEqual(new Redirected('/account#roles'));
      expect(api.calls.map((c) => c.path)).toEqual(['/me']);
    });
  });
});
