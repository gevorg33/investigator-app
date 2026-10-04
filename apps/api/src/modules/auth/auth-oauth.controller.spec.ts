import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppError } from '../../common/errors/app-error';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { validationPipe } from '../../common/validation/pipe';
import { GoogleAuthController } from './google-auth.controller';
import { GoogleAuthService, type CallbackOutcome } from './google-auth.service';

/**
 * Google sign-in at the HTTP layer (T-062): the cookies each step sets and their attributes, where
 * the callback sends the browser and how — and that no Google token or platform token is ever in a
 * body the browser can read.
 */
const ACTOR = testActor({ userId: 'u1', sessionId: 'sess-1' });
const APP = 'https://app.test';
const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=s';

const stub = () => ({
  enabled: true,
  start: vi.fn().mockResolvedValue({ url: GOOGLE_URL, cookie: 'state.verifier' }),
  callback: vi.fn<() => Promise<CallbackOutcome>>(),
  pending: vi.fn().mockResolvedValue({ email: 'ana@example.test' }),
  complete: vi.fn().mockResolvedValue({ userId: 'u-new', refreshToken: 'platform-refresh-token' }),
  methods: vi.fn().mockResolvedValue({ password: true, identities: [] }),
  unlink: vi.fn().mockResolvedValue(undefined),
});

describe('Google sign-in routes', () => {
  let app: INestApplication;
  let google: ReturnType<typeof stub>;
  const saved = process.env['APP_HOST'];

  beforeEach(async () => {
    process.env['APP_HOST'] = 'app.test';
    google = stub();
    const moduleRef = await Test.createTestingModule({
      controllers: [GoogleAuthController],
      providers: [
        { provide: GoogleAuthService, useValue: google },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async (token: string) => {
              if (token === '') throw new AppError('UNAUTHENTICATED');
              return ACTOR;
            },
          },
        },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  });

  afterEach(async () => {
    if (saved === undefined) delete process.env['APP_HOST'];
    else process.env['APP_HOST'] = saved;
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());
  const cookie = (res: request.Response, name: string) =>
    ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));

  it('says whether Google sign-in is offered', async () => {
    expect((await http().get('/api/v1/auth/providers')).body).toEqual({ google: true });
  });

  describe('leaving for Google', () => {
    it('redirects there, with the browser’s half in a short-lived Lax cookie for the Google routes', async () => {
      const res = await http().get('/api/v1/auth/google/start?next=%2Fmissions');
      expect(res.status).toBe(303);
      expect(res.headers['location']).toBe(GOOGLE_URL);
      expect(google.start).toHaveBeenCalledWith({ returnTo: '/missions' }, expect.anything());
      const set = cookie(res, 'investigator_oauth')!;
      expect(set).toMatch(/^investigator_oauth=state\.verifier;/);
      expect(set).toContain('HttpOnly');
      expect(set).toContain('SameSite=Lax');
      expect(set).toContain('Path=/api/v1/auth/google');
      expect(set).toContain('Max-Age=600');
      // Host-only, like the session (ADR-0002).
      expect(set).not.toContain('Domain=');
    });

    it('connects Google only for a signed-in account, and for that account', async () => {
      expect((await http().get('/api/v1/auth/google/link')).status).toBe(401);
      expect(google.start).not.toHaveBeenCalled();
      const res = await http()
        .get('/api/v1/auth/google/link?next=%2Faccount')
        .set('Cookie', 'investigator_session=tok');
      expect(res.status).toBe(303);
      expect(google.start).toHaveBeenCalledWith(
        { returnTo: '/account', actor: ACTOR },
        expect.anything(),
      );
    });
  });

  describe('coming back', () => {
    const back = async (outcome: CallbackOutcome) => {
      google.callback.mockResolvedValue(outcome);
      return http()
        .get('/api/v1/auth/google/callback?code=the-code&state=the-state')
        .set('Cookie', 'investigator_oauth=the-state.the-verifier');
    };
    const refreshesTo = (res: request.Response) =>
      /http-equiv="refresh" content="0;url=([^"]+)"/.exec(res.text)?.[1];

    it('hands the service the query and this browser’s cookie, and spends the cookie', async () => {
      const res = await back({ kind: 'failed', reason: 'failed', intent: 'SIGN_IN' });
      expect(google.callback).toHaveBeenCalledWith(
        { code: 'the-code', state: 'the-state' },
        'the-state.the-verifier',
        expect.anything(),
      );
      expect(cookie(res, 'investigator_oauth')).toMatch(
        /^investigator_oauth=;.*Expires=Thu, 01 Jan 1970/,
      );
    });

    it('signs in with the platform’s own session, then leaves by a same-site navigation', async () => {
      const res = await back({
        kind: 'session',
        session: { userId: 'u1', refreshToken: 'platform-refresh-token' },
        returnTo: '/missions',
      });
      expect(res.status).toBe(200);
      const session = cookie(res, 'investigator_session')!;
      expect(session).toMatch(/^investigator_session=platform-refresh-token;/);
      expect(session).toContain('SameSite=Strict');
      expect(session).toContain('HttpOnly');
      expect(session).not.toContain('Domain=');
      expect(refreshesTo(res)).toBe(`${APP}/session/start?next=%2Fmissions`);
      // Nothing the browser's page can read carries a token.
      expect(res.text).not.toContain('platform-refresh-token');
      expect(res.headers).toMatchObject({
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      });
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    });

    it('sends someone new to accept the documents, carrying the sign-up in a Strict cookie', async () => {
      const res = await back({ kind: 'signup', signupToken: 'signup-secret', returnTo: '/' });
      const set = cookie(res, 'investigator_signup')!;
      expect(set).toMatch(/^investigator_signup=signup-secret;/);
      expect(set).toContain('SameSite=Strict');
      expect(set).toContain('HttpOnly');
      expect(set).toContain('Path=/api/v1/auth/google');
      expect(refreshesTo(res)).toBe(`${APP}/sign-up/google?next=%2F`);
      expect(res.text).not.toContain('signup-secret');
      expect(cookie(res, 'investigator_session')).toBeUndefined();
    });

    it.each([
      [{ kind: 'linked', returnTo: '/account' }, '/account?google=linked#sign-in'],
      [{ kind: 'failed', reason: 'taken', intent: 'LINK' }, '/account?google=taken#sign-in'],
      [{ kind: 'failed', reason: 'denied', intent: 'SIGN_IN' }, '/sign-in?google=denied'],
      [{ kind: 'failed', reason: 'unverified', intent: 'SIGN_IN' }, '/sign-in?google=unverified'],
    ] as const)('leads %j to %s', async (outcome, path) => {
      const res = await back(outcome as CallbackOutcome);
      expect(refreshesTo(res)).toBe(`${APP}${path}`);
      expect(res.text).toContain(`<a href="${APP}${path}">`);
    });

    it('escapes what it writes into the page', async () => {
      // The domain map refuses markup in a host (T-023), so it is the path that carries it here.
      const res = await back({
        kind: 'failed',
        reason: '"&<x>' as never,
        intent: 'SIGN_IN',
      });
      expect(res.text).toContain(`${APP}/sign-in?google=&#34;&#38;&#60;x&#62;`);
      expect(res.text).not.toContain('"&<x>');
    });

    it('falls back to the local app, and to a plain cookie over http in development', async () => {
      delete process.env['APP_HOST'];
      const node = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'development';
      try {
        const res = await back({ kind: 'signup', signupToken: 't', returnTo: '/' });
        expect(refreshesTo(res)).toBe('http://localhost:3000/sign-up/google?next=%2F');
        expect(cookie(res, 'investigator_signup')).not.toContain('Secure');
      } finally {
        process.env['NODE_ENV'] = node;
      }
    });

    it('marks its cookies Secure everywhere else', async () => {
      const res = await back({ kind: 'signup', signupToken: 't', returnTo: '/' });
      expect(cookie(res, 'investigator_signup')).toContain('Secure');
    });
  });

  describe('completing a first sign-in', () => {
    it('shows the address the account will have, from this browser’s sign-up only', async () => {
      const res = await http()
        .get('/api/v1/auth/google/pending')
        .set('Cookie', 'investigator_signup=signup-secret');
      expect(res.body).toEqual({ email: 'ana@example.test' });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(google.pending).toHaveBeenCalledWith('signup-secret');
      google.pending.mockResolvedValue(null);
      expect((await http().get('/api/v1/auth/google/pending')).status).toBe(404);
    });

    it('creates the account with what was accepted, signs in, and spends the sign-up', async () => {
      const id = '00000000-0000-4000-8000-000000000001';
      const res = await http()
        .post('/api/v1/auth/google/complete')
        .set('Cookie', 'investigator_signup=signup-secret')
        .send({ acceptedDocumentIds: [id], locale: 'ru', timezone: 'Europe/Moscow' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'u-new' });
      expect(google.complete).toHaveBeenCalledWith(
        'signup-secret',
        [id],
        { locale: 'ru', timezone: 'Europe/Moscow' },
        expect.anything(),
      );
      expect(cookie(res, 'investigator_session')).toMatch(
        /^investigator_session=platform-refresh-token;/,
      );
      expect(cookie(res, 'investigator_signup')).toMatch(/^investigator_signup=;/);
    });

    it('accepts nothing when nothing is published', async () => {
      await http().post('/api/v1/auth/google/complete').send({});
      expect(google.complete).toHaveBeenCalledWith(
        undefined,
        [],
        expect.anything(),
        expect.anything(),
      );
    });

    it.each([
      ['an address of its own', { email: 'someone@else.test' }],
      ['a password', { password: 'a-sufficiently-long-password' }],
      ['a time zone that is not one', { timezone: '+04:00' }],
    ])('refuses a body with %s', async (_label, body) => {
      const res = await http().post('/api/v1/auth/google/complete').send(body);
      expect(res.status).toBe(400);
      expect(google.complete).not.toHaveBeenCalled();
    });
  });

  describe('sign-in methods', () => {
    it('are the signed-in caller’s own, and never cached', async () => {
      expect((await http().get('/api/v1/auth/identities')).status).toBe(401);
      const res = await http()
        .get('/api/v1/auth/identities')
        .set('Cookie', 'investigator_session=tok');
      expect(res.body).toEqual({ password: true, identities: [] });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(google.methods).toHaveBeenCalledWith(ACTOR);
    });

    it('disconnects one by id, for the caller', async () => {
      const id = '00000000-0000-4000-8000-000000000002';
      expect((await http().delete(`/api/v1/auth/identities/${id}`)).status).toBe(401);
      const res = await http()
        .delete(`/api/v1/auth/identities/${id}`)
        .set('Cookie', 'investigator_session=tok');
      expect(res.status).toBe(204);
      expect(google.unlink).toHaveBeenCalledWith(ACTOR, id, expect.anything());
      expect(
        (
          await http()
            .delete('/api/v1/auth/identities/not-an-id')
            .set('Cookie', 'investigator_session=tok')
        ).status,
      ).toBe(400);
    });
  });
});
