import { colors } from '@investigator/ui-tokens';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import RootLayout, { metadata, viewport } from './layout';
import HomePage from './page';

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

  it('says what the console is, and that sign-in is not open yet', () => {
    render(<HomePage />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Staff console' })).toBeInTheDocument();
    expect(screen.getByText(/Staff sign-in opens with the verification console/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });
});
