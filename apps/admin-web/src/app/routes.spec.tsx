import { colors } from '@investigator/ui-tokens';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Redirected } from '@/test/navigation';
import nextConfig from '../../next.config';
import RootLayout, { metadata, viewport } from './layout';
import HomePage from './page';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

describe('the staff console routes', () => {
  it('is never indexed — by metadata and by header, so neither can be forgotten alone', async () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    const headers = await nextConfig.headers!();
    expect(headers).toEqual([
      { source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]);
    expect(nextConfig.productionBrowserSourceMaps).toBe(false);
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('colours the browser chrome from the surface token, in both themes', () => {
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

  it('opens on its one queue', () => {
    expect(() => HomePage()).toThrow(new Redirected('/verification'));
  });

  it('reaches the API same-origin at /api, as Caddy routes it in every deployed environment', async () => {
    expect(await nextConfig.rewrites!()).toEqual([
      { source: '/api/:path*', destination: 'http://localhost:3001/api/:path*' },
    ]);
  });
});
