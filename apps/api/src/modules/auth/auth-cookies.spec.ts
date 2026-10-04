import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { closeApp, listenOnce } from '../../../test/http';
import type { CallbackOutcome } from './google-auth.service';

// configureApp never touches AppModule, and importing the real one validates the environment.
vi.mock('../../app.module', () => ({ AppModule: class AppModule {} }));

const SESSION = '__Host-investigator_session';
const ACTOR = testActor({ userId: 'u1', sessionId: 'sess-1' });
const ROOT = join(__dirname, '../../../../..');

const authStub = () => ({
  login: vi.fn().mockResolvedValue({ userId: 'u1', refreshToken: 'tok-login' }),
  refresh: vi.fn().mockResolvedValue({ userId: 'u1', refreshToken: 'tok-refreshed' }),
  revoke: vi.fn().mockResolvedValue(undefined),
  resetPassword: vi.fn().mockResolvedValue(undefined),
});
const googleStub = () => ({
  enabled: true,
  start: vi.fn().mockResolvedValue({ url: 'https://accounts.google.com/x', cookie: 's.v' }),
  callback: vi.fn<() => Promise<CallbackOutcome>>(),
  complete: vi.fn().mockResolvedValue({ userId: 'u-new', refreshToken: 'tok-google' }),
});

/** One parsed Set-Cookie: its name, and its attributes lower-cased, without the date. */
const parse = (line: string) => {
  const [pair, ...attributes] = line.split(';').map((p) => p.trim());
  return {
    line,
    name: pair!.slice(0, pair!.indexOf('=')),
    attributes: attributes
      .map((a) => a.toLowerCase())
      .filter((a) => !a.startsWith('expires=') && !a.startsWith('max-age='))
      .sort(),
  };
};

/**
 * Every cookie the API sets or clears (T-025), from every route that does, as the browser receives
 * it — through the global configuration a deployed API runs.
 */
async function everyCookie(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  const google = googleStub();
  let app: INestApplication | undefined;
  try {
    // Imported afresh under this environment: a cookie option computed when its module loads is
    // computed here, in development as much as in production — not once, under the test runner's.
    vi.resetModules();
    const { configureApp } = await import('../../bootstrap');
    const { ActorService } = await import('../../common/authz/actor.service');
    const { workspaceResolverStub } = await import('../../../test/context');
    const { AuthController } = await import('./auth.controller');
    const { AuthService } = await import('./auth.service');
    const { GoogleAuthController } = await import('./google-auth.controller');
    const { GoogleAuthService } = await import('./google-auth.service');
    const mod = await Test.createTestingModule({
      controllers: [AuthController, GoogleAuthController],
      providers: [
        { provide: AuthService, useValue: authStub() },
        { provide: GoogleAuthService, useValue: google },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    await configureApp(app);
    await listenOnce(app);
    const http = () => request(app!.getHttpServer());
    const signedIn = `${SESSION}=tok`;
    const back = (outcome: CallbackOutcome) => {
      google.callback.mockResolvedValueOnce(outcome);
      return http()
        .get('/api/v1/auth/google/callback?code=c&state=s')
        .set('Cookie', 'investigator_oauth=s.v');
    };
    const responses = {
      login: await http()
        .post('/api/v1/auth/login')
        .send({ email: 'probe@example.test', password: 'a-sufficiently-long-password' }),
      refresh: await http().post('/api/v1/auth/refresh').set('Cookie', signedIn),
      reset: await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token: 't', password: 'a-sufficiently-long-password' }),
      logout: await http().post('/api/v1/auth/logout').set('Cookie', signedIn),
      googleStart: await http().get('/api/v1/auth/google/start'),
      googleLink: await http().get('/api/v1/auth/google/link').set('Cookie', signedIn),
      googleSession: await back({
        kind: 'session',
        session: { userId: 'u1', refreshToken: 'tok-google' },
        returnTo: '/',
      }),
      googleSignup: await back({ kind: 'signup', signupToken: 'su', returnTo: '/' }),
      googleComplete: await http()
        .post('/api/v1/auth/google/complete')
        .set('Cookie', 'investigator_signup=su')
        .send({}),
    };
    return Object.fromEntries(
      Object.entries(responses).map(([route, res]) => [
        route,
        ([] as string[]).concat(res.headers['set-cookie'] ?? []).map(parse),
      ]),
    );
  } finally {
    await closeApp(app);
    process.env = saved;
  }
}

describe('cookies the API sets (T-025)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('found a cookie on every route that sets or clears one', async () => {
    const cookies = await everyCookie({ NODE_ENV: 'test' });
    for (const [route, set] of Object.entries(cookies))
      expect(set.length, route).toBeGreaterThan(0);
  });

  it.each(['development', 'test', 'production'])(
    'never carries a Domain attribute — in %s',
    async (NODE_ENV) => {
      const cookies = await everyCookie({ NODE_ENV, DOMAIN: 'example.test' });
      const scoped = Object.values(cookies)
        .flat()
        .filter((c) => c.attributes.some((a) => a.startsWith('domain=')));
      expect(scoped.map((c) => c.line)).toEqual([]);
    },
  );

  it.each(['development', 'test', 'production'])(
    'sets and clears the session as __Host-: Secure, HttpOnly, SameSite=Strict, Path=/ — in %s',
    async (NODE_ENV) => {
      const cookies = await everyCookie({ NODE_ENV });
      const session = Object.entries(cookies).flatMap(([route, set]) =>
        set.filter((c) => c.name.endsWith('investigator_session')).map((c) => ({ route, ...c })),
      );
      expect(session.map((c) => c.route).sort()).toEqual(
        ['googleComplete', 'googleSession', 'login', 'logout', 'refresh', 'reset'].sort(),
      );
      for (const c of session) {
        // A clear without Secure and Path=/ is refused for a __Host- cookie, so it must carry both.
        expect(c.name, c.route).toBe(SESSION);
        expect(c.attributes, c.route).toEqual(['httponly', 'path=/', 'samesite=strict', 'secure']);
      }
    },
  );

  it('scopes the session the same whatever the domain map holds — a new site cannot widen it', async () => {
    const attributesOf = async (env: Record<string, string | undefined>) =>
      (await everyCookie({ NODE_ENV: 'production', ...env }))['login']!;
    const local = await attributesOf({ DOMAIN: undefined });
    const deployed = await attributesOf({ DOMAIN: 'example.test' });
    const moved = await attributesOf({
      DOMAIN: 'example.test',
      ADMIN_HOST: 'staff.example.test',
      NEWS_HOST: 'letters.example.test',
    });
    expect(deployed).toEqual(local);
    expect(moved).toEqual(local);
  });

  it('sets the Google flow’s cookies host-only too, on its own path', async () => {
    const cookies = await everyCookie({ NODE_ENV: 'production' });
    const flow = Object.values(cookies)
      .flat()
      .filter((c) => !c.name.endsWith('investigator_session'));
    expect(new Set(flow.map((c) => c.name))).toEqual(
      new Set(['investigator_oauth', 'investigator_signup']),
    );
    for (const c of flow) expect(c.attributes).toContain('path=/api/v1/auth/google');
  });
});

describe('cookie options in source', () => {
  it('name no Domain anywhere a cookie is set — API, app and console', () => {
    const files = globSync(['apps/{api,app-web,admin-web}/src/**/*.{ts,tsx}'], {
      cwd: ROOT,
    }).filter((p) => !/\.spec\.tsx?$/.test(p));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((p) => /\bdomain\s*:/.test(readFileSync(join(ROOT, p), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
