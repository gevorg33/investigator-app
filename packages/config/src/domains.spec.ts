import { describe, expect, it } from 'vitest';

import { appUrl, DomainConfigError, domains } from './index.js';

describe('domains', () => {
  it('derives every site from the apex, over HTTPS', () => {
    expect(domains({ DOMAIN: 'mydomain.com' })).toEqual({
      marketing: 'https://mydomain.com',
      app: 'https://app.mydomain.com',
      admin: 'https://admin.mydomain.com',
      news: 'https://news.mydomain.com',
    });
  });

  it('takes a site’s own host over the one derived from the apex', () => {
    const map = domains({ DOMAIN: 'mydomain.com', ADMIN_HOST: 'staff.mydomain.com' });
    expect(map.admin).toBe('https://staff.mydomain.com');
    expect(map.app).toBe('https://app.mydomain.com');
  });

  it('falls back to the dev servers, over plain HTTP, with no DOMAIN', () => {
    expect(domains({})).toEqual({
      marketing: 'http://localhost:3003',
      app: 'http://localhost:3000',
      admin: 'http://localhost:3002',
      news: 'http://localhost:3004',
    });
  });

  it('reads an empty variable as unset, as .env.example leaves them', () => {
    expect(domains({ DOMAIN: '', APP_HOST: '' }).app).toBe('http://localhost:3000');
  });

  it('keeps plain HTTP for loopback only — a .localhost name goes through Caddy’s TLS', () => {
    expect(domains({ APP_HOST: '127.0.0.1:3100' }).app).toBe('http://127.0.0.1:3100');
    expect(domains({ DOMAIN: 'investigator.localhost' }).app).toBe(
      'https://app.investigator.localhost',
    );
  });

  it('reads process.env when given nothing', () => {
    const saved = process.env['DOMAIN'];
    process.env['DOMAIN'] = 'from-process.test';
    try {
      expect(domains().marketing).toBe('https://from-process.test');
      expect(appUrl('/x')).toBe('https://app.from-process.test/x');
    } finally {
      if (saved === undefined) delete process.env['DOMAIN'];
      else process.env['DOMAIN'] = saved;
    }
  });

  it.each([
    ['a scheme', 'https://mydomain.com'],
    ['a path', 'mydomain.com/app'],
    ['credentials', 'user@mydomain.com'],
    ['upper case', 'MyDomain.com'],
    ['a trailing dot', 'mydomain.com.'],
    ['markup', 'mydomain.com/"><x>'],
  ])('refuses a host carrying %s, naming the variable and not the value', (_, host) => {
    expect(() => domains({ DOMAIN: host })).toThrow(
      new DomainConfigError('DOMAIN', 'must be a bare lowercase hostname, optionally with a port'),
    );
    expect(() => domains({ DOMAIN: host })).not.toThrow(host);
  });

  it('names the override that is malformed, not the apex', () => {
    expect(() => domains({ DOMAIN: 'mydomain.com', NEWS_HOST: 'news .mydomain.com' })).toThrow(
      expect.objectContaining({ name: 'DomainConfigError', variable: 'NEWS_HOST' }),
    );
  });

  it('refuses two sites on one origin — staff must never share app.’s', () => {
    expect(() => domains({ DOMAIN: 'mydomain.com', ADMIN_HOST: 'app.mydomain.com' })).toThrow(
      'ADMIN_HOST names a host another site already serves from',
    );
  });
});

describe('appUrl', () => {
  it('joins the app origin and the path', () => {
    expect(appUrl('/missions/7?tab=quotes', { DOMAIN: 'mydomain.com' })).toBe(
      'https://app.mydomain.com/missions/7?tab=quotes',
    );
  });
});
