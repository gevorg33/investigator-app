// Each application's Content-Security-Policy (ADR-0002, T-025). Set by the application itself, per
// request — never at the edge, where one policy would have to fit sites that need different ones.

import type { Site } from './domains.js';

/**
 * The providers a page talks to directly, and why. Nothing else outside the page's own origin is
 * allowed. Another site of the domain map is never one: each site is `'self'` to itself and a
 * stranger to the others, so adding a site to the map cannot widen any policy.
 */
const PROVIDER = {
  // Uploads go from the browser straight to storage, signed by the API, and images come back
  // through short-lived signed links on the same host (`media/cloudinary.storage.ts`).
  media: 'https://api.cloudinary.com',
  // "Continue with Google" is a form the API answers with a redirect to Google; browsers hold a
  // form's redirects to `form-action` too (`google-sign-in.md`).
  googleSignIn: 'https://accounts.google.com',
} as const;

/** The sites that serve pages today. Marketing and news join when they exist (T-203). */
export type PolicySite = Extract<Site, 'app' | 'admin'>;

const EXTRA: Readonly<Record<PolicySite, { connect: string[]; img: string[]; form: string[] }>> = {
  app: { connect: [PROVIDER.media], img: [PROVIDER.media], form: [PROVIDER.googleSignIn] },
  // Staff open documents in a tab of their own, by navigation, which this policy does not govern.
  admin: { connect: [], img: [], form: [] },
};

export interface PolicyOptions {
  /** Fresh for every response; the framework puts it on each script it renders. */
  nonce: string;
  /** The dev server evaluates code for fast refresh, which production never does. */
  development?: boolean;
}

/**
 * The policy for one response from `site`. Scripts run only with this response's nonce, and what
 * they load (`'strict-dynamic'`); styles may be inline, because server-rendered markup carries
 * style attributes. The page cannot be framed, cannot change its base URL, and embeds no plugins.
 */
export function contentSecurityPolicy(
  site: PolicySite,
  { nonce, development = false }: PolicyOptions,
): string {
  const extra = EXTRA[site];
  const script = [
    `'self'`,
    `'nonce-${nonce}'`,
    `'strict-dynamic'`,
    ...(development ? [`'unsafe-eval'`] : []),
  ];
  const directives: Array<[string, string[]]> = [
    ['default-src', [`'self'`]],
    ['script-src', script],
    ['style-src', [`'self'`, `'unsafe-inline'`]],
    ['img-src', [`'self'`, 'data:', 'blob:', ...extra.img]],
    ['font-src', [`'self'`]],
    ['connect-src', [`'self'`, ...extra.connect]],
    ['form-action', [`'self'`, ...extra.form]],
    ['frame-ancestors', [`'none'`]],
    ['base-uri', [`'none'`]],
    ['object-src', [`'none'`]],
  ];
  return directives.map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
