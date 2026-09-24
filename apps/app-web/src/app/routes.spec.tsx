import { catalogs } from '@investigator/i18n';
import { colors } from '@investigator/ui-tokens';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';
import { I18nProvider } from '@/i18n/provider';
import { api, apiError } from '@/test/api';
import { account, legalDocument, session } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { Redirected } from '@/test/navigation';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import AccountPage, { generateMetadata as accountMeta } from './(workspace)/account/page';
import AssistantPage, { generateMetadata as assistantMeta } from './(workspace)/assistant/page';
import WorkspaceLayout from './(workspace)/layout';
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
    // Client components translate navigation, the auth and account forms, legal text and errors.
    expect(CLIENT_NAMESPACES).toEqual(['nav', 'auth', 'account', 'legal', 'error']);
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
    const tree = await resolveServer(await WorkspaceLayout({ children: 'inside' }));
    render(
      <I18nProvider locale="en" messages={{ nav: catalogs.en.nav }}>
        {tree}
      </I18nProvider>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveTextContent('inside');
    expect(screen.getByRole('status')).toHaveTextContent(catalogs.en.shell.outstanding);
    expect(screen.getByRole('status')).toHaveTextContent(catalogs.en.shell.unverified);
  });

  it('owes nothing, shows nothing', async () => {
    api.on('GET /me', 200, account());
    api.on('GET /legal/outstanding', 200, []);
    render(
      <I18nProvider locale="en" messages={{ nav: catalogs.en.nav }}>
        {await resolveServer(await WorkspaceLayout({ children: 'inside' }))}
      </I18nProvider>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('inside');
    expect(screen.queryByRole('status')).toBeNull();
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
    ['Missions', MissionsPage, missionsMeta, 'No missions yet'],
    ['Messages', MessagesPage, messagesMeta, 'No conversations yet'],
    ['Assistant', AssistantPage, assistantMeta, 'The assistant is on its way'],
  ])('%s says what it is and what will appear there', async (title, Page, meta, empty) => {
    render(await resolveServer(await Page()));
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: empty })).toBeInTheDocument();
    if (meta !== undefined) expect((await meta()).title).toBe(title);
  });

  it('renders every page in the reader’s chosen language', async () => {
    request.cookies.set('locale', 'hy');
    render(await MissionsPage());
    expect(
      screen.getByRole('heading', { level: 1, name: catalogs.hy.nav.missions }),
    ).toBeInTheDocument();
    expect(screen.getByText(catalogs.hy.missions.empty.body)).toBeInTheDocument();
    expect((await missionsMeta()).title).toBe(catalogs.hy.nav.missions);
  });

  describe('the account page', () => {
    const signedIn = (outstanding: unknown[]) => {
      api.on('GET /me', 200, account({ timezone: 'Asia/Yerevan' }));
      api.on('GET /legal/outstanding', 200, outstanding);
      api.on('GET /legal/required?for=INVESTIGATOR&locale=en', 200, []);
      api.on('GET /auth/sessions', 200, { sessions: [session({ current: true })] });
    };
    const sections = () => screen.getAllByRole('region').map((r) => r.id);

    it('puts documents to accept first, then who, roles, language, time zone and sessions', async () => {
      signedIn([legalDocument()]);
      renderIntl(await resolveServer(await AccountPage()));
      expect(screen.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
      expect(sections()).toEqual(['legal', 'profile', 'roles', '', 'timezone', 'sessions']);
      expect(screen.getByRole('region', { name: 'Language' })).toBeVisible();
      expect(screen.getByText('Now showing times in Asia/Yerevan.')).toBeVisible();
      expect((await accountMeta()).title).toBe('Account');
    });

    it('has no documents section when nothing is outstanding', async () => {
      signedIn([]);
      renderIntl(await resolveServer(await AccountPage()));
      expect(sections()).not.toContain('legal');
    });
  });
});
