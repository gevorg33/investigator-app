import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, middleware } from './middleware';

const arrive = (path: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(new URL(path, 'https://admin.example.test'), { headers }));

const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1];

describe('the console’s middleware', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('tells the page which address was asked for, over anything the client sent', () => {
    const res = arrive('/verification/7?tab=docs', { 'x-pathname': '//evil.test' });
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/verification/7?tab=docs');
  });

  it('gives every page the console’s policy, with a nonce of its own (T-025)', () => {
    const first = arrive('/verification');
    const policy = first.headers.get('content-security-policy');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self';");
    expect(policy).not.toContain('accounts.google.com');
    // The same policy reaches Next on the request, which stamps the nonce on each script.
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    const nonce = nonceOf(policy);
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(nonceOf(arrive('/verification').headers.get('content-security-policy'))).not.toBe(nonce);
  });

  it('lets only the dev server evaluate code', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(arrive('/').headers.get('content-security-policy')).toContain("'unsafe-eval'");
    vi.stubEnv('NODE_ENV', 'production');
    expect(arrive('/').headers.get('content-security-policy')).not.toContain("'unsafe-eval'");
  });

  it('runs for pages, never for the API, Next’s assets or files', () => {
    const [pattern] = config.matcher;
    const runs = (path: string) => new RegExp(`^${pattern}$`).test(path);
    expect([runs('/'), runs('/verification/42')]).toEqual([true, true]);
    expect([runs('/_next/static/a.js'), runs('/api/v1/me'), runs('/favicon.ico')]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
