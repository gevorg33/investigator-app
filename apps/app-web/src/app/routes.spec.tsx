import { colors } from '@investigator/ui-tokens';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';
import AccountPage, { metadata as accountMeta } from './(workspace)/account/page';
import AssistantPage, { metadata as assistantMeta } from './(workspace)/assistant/page';
import WorkspaceLayout from './(workspace)/layout';
import MessagesPage, { metadata as messagesMeta } from './(workspace)/messages/page';
import MissionsPage, { metadata as missionsMeta } from './(workspace)/missions/page';
import HomePage from './(workspace)/page';
import RootLayout, { metadata, viewport } from './layout';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

describe('the application routes', () => {
  it('is never indexed — by metadata and by header, so neither can be forgotten alone', async () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
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

  it('declares the document language', () => {
    const html = RootLayout({ children: 'x' }) as ReactElement<{ lang: string }>;
    expect(html.type).toBe('html');
    expect(html.props.lang).toBe('en');
  });

  it('frames every workspace route with the shell', () => {
    render(<WorkspaceLayout>inside</WorkspaceLayout>);
    expect(screen.getByRole('main')).toHaveTextContent('inside');
  });

  it.each([
    ['Home', HomePage, undefined, 'Nothing needs you yet'],
    ['Missions', MissionsPage, missionsMeta, 'No missions yet'],
    ['Messages', MessagesPage, messagesMeta, 'No conversations yet'],
    ['Assistant', AssistantPage, assistantMeta, 'The assistant is on its way'],
    ['Account', AccountPage, accountMeta, 'Your account'],
  ])('%s says what it is and what will appear there', (title, Page, meta, empty) => {
    render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: empty })).toBeInTheDocument();
    if (meta !== undefined) expect(meta.title).toBe(title);
  });
});
