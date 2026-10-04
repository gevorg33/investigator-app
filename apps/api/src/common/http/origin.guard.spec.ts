import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors/app-error';
import { crossOrigin, OriginGuard } from './origin.guard';

const ENV = { DOMAIN: 'example.test' };
const req = (method: string, headers: Record<string, string>) => ({
  method,
  get: (name: string) => headers[name.toLowerCase()],
});

/**
 * Which writes are a page of another origin acting with the reader's cookie (T-025). The domain
 * map names the sites the API serves; the browser says where a request comes from.
 */
describe('crossOrigin', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('never refuses %s, which changes nothing', (method) => {
    expect(crossOrigin(req(method, { 'sec-fetch-site': 'cross-site' }), ENV)).toBe(false);
  });

  it.each([
    ['same-origin', false],
    ['none', false],
    ['same-site', true],
    ['cross-site', true],
  ])('takes the browser’s Sec-Fetch-Site %s over everything else', (site, refused) => {
    // Origin agreeing with the host changes nothing: the browser's own header decides.
    const headers = {
      'sec-fetch-site': site,
      origin: 'https://app.example.test',
      host: 'app.example.test',
    };
    expect(crossOrigin(req('POST', headers), ENV)).toBe(refused);
  });

  it('lets a request no browser sent through — the app’s own server, a mail provider', () => {
    expect(crossOrigin(req('POST', {}), ENV)).toBe(false);
  });

  describe('a browser that sends Origin and no Sec-Fetch-Site', () => {
    const write = (origin: string, host: string, forwardedHost?: string) =>
      crossOrigin(
        req('DELETE', {
          origin,
          host,
          ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
        }),
        ENV,
      );

    it('accepts each served site writing to its own host', () => {
      expect(write('https://app.example.test', 'app.example.test')).toBe(false);
      expect(write('https://admin.example.test', 'admin.example.test')).toBe(false);
    });

    it('reads the host Caddy says the request arrived on', () => {
      expect(write('https://app.example.test', 'api:3001', 'app.example.test')).toBe(false);
      expect(write('https://app.example.test', 'app.example.test', 'admin.example.test')).toBe(
        true,
      );
    });

    it('refuses app.’s pages writing to admin.’s API, and the reverse', () => {
      expect(write('https://app.example.test', 'admin.example.test')).toBe(true);
      expect(write('https://admin.example.test', 'app.example.test')).toBe(true);
    });

    it('refuses the sites that serve no API, and every stranger', () => {
      expect(write('https://news.example.test', 'news.example.test')).toBe(true);
      expect(write('https://example.test', 'example.test')).toBe(true);
      expect(write('https://evil.example', 'evil.example')).toBe(true);
      expect(write('http://app.example.test', 'app.example.test')).toBe(true);
    });
  });

  it('reads the domain map from the environment by default', () => {
    // No DOMAIN here: the map is the dev servers', and app-web's is localhost:3000.
    const saved = process.env['DOMAIN'];
    delete process.env['DOMAIN'];
    try {
      expect(
        crossOrigin(req('POST', { origin: 'http://localhost:3000', host: 'localhost:3000' })),
      ).toBe(false);
    } finally {
      if (saved !== undefined) process.env['DOMAIN'] = saved;
    }
  });
});

describe('OriginGuard', () => {
  const context = (r: ReturnType<typeof req>) =>
    ({ switchToHttp: () => ({ getRequest: () => r }) }) as unknown as ExecutionContext;

  it('lets a same-origin write through, and stops a cross-origin one with FORBIDDEN', () => {
    const guard = new OriginGuard();
    expect(guard.canActivate(context(req('POST', { 'sec-fetch-site': 'same-origin' })))).toBe(true);
    expect(() =>
      guard.canActivate(context(req('POST', { 'sec-fetch-site': 'same-site' }))),
    ).toThrow(AppError);
  });
});
