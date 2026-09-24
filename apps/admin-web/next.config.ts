import type { NextConfig } from 'next';

/**
 * The staff console (`admin.`, ADR-0002). Never indexed: the robots header is set here for every
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
};

export default config;
