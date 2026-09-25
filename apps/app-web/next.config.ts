import type { NextConfig } from 'next';

/**
 * The application (`app.`, ADR-0002). Never indexed: the robots header is set here for every
 * response, and the root layout's metadata says the same, so neither can be forgotten alone.
 */
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Source maps reconstruct the source; none reach a public bundle (launch-hardening, T-028).
  productionBrowserSourceMaps: false,
  // Linting runs once, at the root, with the monorepo's config (`pnpm lint`) — not a second
  // time inside `next build` with a different one.
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
  // The API is same-origin at `/api` (ADR-0002): Caddy routes it in every deployed environment,
  // before a request reaches this app. In development nothing does, so this stands in for Caddy —
  // the browser still sees one origin, and the session cookie stays host-only (T-127).
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env['API_INTERNAL_URL'] ?? 'http://localhost:3001'}/api/:path*`,
      },
    ];
  },
};

export default config;
