import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, domains, SESSION_COOKIE, type PolicySite } from './index.js';

const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy.split('; ').map((d) => {
      const [name, ...sources] = d.split(' ');
      return [name!, sources];
    }),
  );

describe('contentSecurityPolicy', () => {
  it('runs only the scripts carrying this response’s nonce, and what they load', () => {
    const policy = directives(contentSecurityPolicy('app', { nonce: 'n0nce' }));
    expect(policy['script-src']).toEqual([`'self'`, `'nonce-n0nce'`, `'strict-dynamic'`]);
    expect(policy['script-src']).not.toContain(`'unsafe-inline'`);
    expect(policy['script-src']).not.toContain(`'unsafe-eval'`);
  });

  it('lets the dev server evaluate code, and nothing else does', () => {
    expect(
      directives(contentSecurityPolicy('app', { nonce: 'n', development: true }))['script-src'],
    ).toContain(`'unsafe-eval'`);
  });

  it.each<PolicySite>(['app', 'admin'])(
    'forbids framing, base changes and plugins on %s',
    (site) => {
      const policy = directives(contentSecurityPolicy(site, { nonce: 'n' }));
      expect(policy['frame-ancestors']).toEqual([`'none'`]);
      expect(policy['base-uri']).toEqual([`'none'`]);
      expect(policy['object-src']).toEqual([`'none'`]);
      expect(policy['default-src']).toEqual([`'self'`]);
    },
  );

  it('opens app. to exactly the providers it uses: storage, and Google’s sign-in redirect', () => {
    const policy = directives(contentSecurityPolicy('app', { nonce: 'n' }));
    expect(policy['connect-src']).toEqual([`'self'`, 'https://api.cloudinary.com']);
    expect(policy['img-src']).toEqual([`'self'`, 'data:', 'blob:', 'https://api.cloudinary.com']);
    expect(policy['form-action']).toEqual([`'self'`, 'https://accounts.google.com']);
  });

  it('opens admin. to nothing beyond itself', () => {
    const policy = directives(contentSecurityPolicy('admin', { nonce: 'n' }));
    expect(policy['connect-src']).toEqual([`'self'`]);
    expect(policy['form-action']).toEqual([`'self'`]);
    expect(policy['img-src']).toEqual([`'self'`, 'data:', 'blob:']);
  });

  it('names no other site of the domain map, so the map cannot widen a policy', () => {
    const map = domains({ DOMAIN: 'example.test' });
    for (const site of ['app', 'admin'] as const) {
      const policy = contentSecurityPolicy(site, { nonce: 'n' });
      for (const origin of Object.values(map)) {
        expect(policy).not.toContain(new URL(origin).host);
      }
    }
  });
});

describe('SESSION_COOKIE', () => {
  it('carries the prefix with which browsers refuse a Domain attribute', () => {
    expect(SESSION_COOKIE).toMatch(/^__Host-/);
  });
});
