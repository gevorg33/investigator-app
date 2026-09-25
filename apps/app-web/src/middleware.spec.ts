import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, middleware } from './middleware';

const arrive = (url: string) =>
  middleware(new NextRequest(new URL(url, 'https://app.example.test')));

describe('a link that says which language its reader chose', () => {
  it('records it as their choice and sends them on without the parameter', () => {
    const res = arrive('/missions?lang=ru&tab=open');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.example.test/missions?tab=open');
    const cookie = res.cookies.get('locale')!;
    expect(cookie).toMatchObject({
      value: 'ru',
      path: '/',
      maxAge: 31_536_000,
      sameSite: 'lax',
      secure: true,
      httpOnly: true,
    });
    expect(cookie).not.toHaveProperty('domain');
  });

  it.each([['de'], ['<script>'], ['']])(
    'drops an unknown language (%s) without choosing anything',
    (lang) => {
      const res = arrive(`/?lang=${encodeURIComponent(lang)}`);
      expect(res.headers.get('location')).toBe('https://app.example.test/');
      expect(res.cookies.get('locale')).toBeUndefined();
    },
  );

  it('leaves every other request alone', () => {
    const res = arrive('/account?tab=language');
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.cookies.getAll()).toEqual([]);
  });

  it('tells the page which address was asked for, so signing in can return to it', () => {
    const res = middleware(
      new NextRequest(new URL('/missions/7?tab=quotes', 'https://app.example.test'), {
        // A client cannot choose where it is sent back to: the header is always overwritten.
        headers: { 'x-pathname': '//evil.test' },
      }),
    );
    expect(res.headers.get('x-middleware-request-x-pathname')).toBe('/missions/7?tab=quotes');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-pathname');
  });

  it('runs for pages, never for the API, Next’s assets or files', () => {
    const [pattern] = config.matcher;
    const runs = (path: string) => new RegExp(`^${pattern}$`).test(path);
    expect([runs('/'), runs('/missions/42'), runs('/account')]).toEqual([true, true, true]);
    expect([
      runs('/_next/static/chunks/a.js'),
      runs('/favicon.ico'),
      runs('/robots.txt'),
      // The API owns its own requests; the dev rewrite passes them straight through.
      runs('/api/v1/auth/login'),
    ]).toEqual([false, false, false, false]);
  });
});
