import { catalogs } from '@investigator/i18n';
import { colors } from '@investigator/ui-tokens';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';
import { I18nProvider } from '@/i18n/provider';
import { request } from '@/test/request';
import { resolveServer } from '@/test/server';
import AccountPage, { generateMetadata as accountMeta } from './(workspace)/account/page';
import AssistantPage, { generateMetadata as assistantMeta } from './(workspace)/assistant/page';
import WorkspaceLayout from './(workspace)/layout';
import MessagesPage, { generateMetadata as messagesMeta } from './(workspace)/messages/page';
import MissionsPage, { generateMetadata as missionsMeta } from './(workspace)/missions/page';
import HomePage from './(workspace)/page';
import RootLayout, { CLIENT_NAMESPACES, generateMetadata, viewport } from './layout';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/headers', async () => (await import('@/test/request')).nextHeaders);
vi.mock('./(workspace)/account/actions', () => ({ chooseLocale: vi.fn() }));

type Html = ReactElement<{
  lang: string;
  children: ReactElement<{ children: ReactElement<{ locale: string; messages: object }> }>;
}>;

describe('the application routes', () => {
  beforeEach(() => request.reset());

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
    expect(provider.props.messages).toEqual({ nav: catalogs.ru.nav });
    expect(CLIENT_NAMESPACES).toEqual(['nav']);
    expect((await generateMetadata()).title).toEqual({
      default: 'Investigator',
      template: '%s · Investigator',
    });
  });

  it('frames every workspace route with the shell', async () => {
    const tree = await resolveServer(WorkspaceLayout({ children: 'inside' }));
    render(
      <I18nProvider locale="en" messages={{ nav: catalogs.en.nav }}>
        {tree}
      </I18nProvider>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('inside');
  });

  it.each([
    ['Home', HomePage, undefined, 'Nothing needs you yet'],
    ['Missions', MissionsPage, missionsMeta, 'No missions yet'],
    ['Messages', MessagesPage, messagesMeta, 'No conversations yet'],
    ['Assistant', AssistantPage, assistantMeta, 'The assistant is on its way'],
    ['Account', AccountPage, accountMeta, 'Your account'],
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
});
