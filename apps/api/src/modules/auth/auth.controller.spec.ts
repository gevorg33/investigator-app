import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ActorService } from '../../common/authz/actor.service';
import { testActor } from '../../../test/authz-cases';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';

const CREDENTIALS = { email: 'probe@example.test', password: 'a-sufficiently-long-password' };
const COOKIE = 'investigator_session';
const ACTOR = testActor({ userId: 'u1', sessionId: 'sess-1' });

/** Records what the controller passed through, so context handling is observable. */
const stub = () => ({
  register: vi.fn().mockResolvedValue(undefined),
  login: vi.fn().mockResolvedValue({ userId: 'u1', refreshToken: 'tok-login' }),
  refresh: vi.fn().mockResolvedValue({ userId: 'u1', refreshToken: 'tok-refreshed' }),
  revoke: vi.fn().mockResolvedValue(undefined),
  verifyEmail: vi.fn().mockResolvedValue(undefined),
  requestEmailVerification: vi.fn().mockResolvedValue(undefined),
  requestPasswordReset: vi.fn().mockResolvedValue(undefined),
  resetPassword: vi.fn().mockResolvedValue(undefined),
  listSessions: vi.fn().mockResolvedValue([]),
  revokeSession: vi.fn().mockResolvedValue(undefined),
});

describe('auth controller', () => {
  let app: INestApplication;
  let auth: ReturnType<typeof stub>;
  // Assigned onto the request the way pino-http does, to exercise normalisation.
  let requestId: unknown;

  beforeEach(async () => {
    auth = stub();
    requestId = 'correlation-abc';

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        // The guard's own behaviour is covered in actor.service.spec.ts; here it stands
        // in so the session routes can be exercised at the HTTP layer.
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { id?: unknown }).id = requestId;
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const post = (path: string) => request(app.getHttpServer()).post(`/auth/${path}`);

  describe('register', () => {
    it('answers 202 without revealing whether the address exists', async () => {
      const res = await post('register').send(CREDENTIALS);
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'accepted' });
      expect(auth.register).toHaveBeenCalledWith(
        CREDENTIALS.email,
        CREDENTIALS.password,
        expect.objectContaining({ correlationId: 'correlation-abc' }),
        // What the caller is accepting travels with the registration (T-022).
        [],
      );
    });

    it('sets no session cookie — registration does not authenticate', async () => {
      const res = await post('register').send(CREDENTIALS);
      expect(res.headers['set-cookie']).toBeUndefined();
    });
  });

  describe('login', () => {
    it('returns the user id and sets the session cookie', async () => {
      const res = await post('login').send(CREDENTIALS);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: 'u1' });
      expect(res.headers['set-cookie'][0]).toContain(`${COOKIE}=tok-login`);
    });

    it('never returns the refresh token in the body', async () => {
      const res = await post('login').send(CREDENTIALS);
      expect(JSON.stringify(res.body)).not.toContain('tok-login');
    });

    it('marks the cookie HttpOnly, SameSite=Strict and host-only', async () => {
      const res = await post('login').send(CREDENTIALS);
      const cookie = res.headers['set-cookie'][0];
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
      // No Domain attribute: the cookie must never reach a sibling subdomain (ADR-0002).
      expect(cookie).not.toContain('Domain');
    });
  });

  describe('refresh', () => {
    it('reads the token from the cookie and rotates it', async () => {
      const res = await post('refresh').set('Cookie', [`${COOKIE}=tok-old`]).send();
      expect(res.status).toBe(200);
      expect(auth.refresh).toHaveBeenCalledWith('tok-old', expect.any(Object));
      expect(res.headers['set-cookie'][0]).toContain(`${COOKIE}=tok-refreshed`);
    });

    it('passes an empty token when no cookie is present', async () => {
      // The service decides; the controller must not throw on a missing cookie.
      await post('refresh').send();
      expect(auth.refresh).toHaveBeenCalledWith('', expect.any(Object));
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const res = await post('logout').set('Cookie', [`${COOKIE}=tok-old`]).send();
      expect(res.status).toBe(204);
      expect(auth.revoke).toHaveBeenCalledWith('tok-old', expect.any(Object));
      // Cleared by expiry in the past, not by omission.
      expect(res.headers['set-cookie'][0]).toContain(`${COOKIE}=;`);
    });

    it('still clears the cookie when there was no session to revoke', async () => {
      const res = await post('logout').send();
      expect(res.status).toBe(204);
      expect(auth.revoke).not.toHaveBeenCalled();
      expect(res.headers['set-cookie'][0]).toContain(`${COOKIE}=;`);
    });
  });

  describe('correlation id normalisation', () => {
    it('passes a string id through unchanged', async () => {
      requestId = 'abc';
      await post('register').send(CREDENTIALS);
      expect(auth.register.mock.calls[0][2]).toMatchObject({ correlationId: 'abc' });
    });

    it('stringifies a numeric id, so the shape is uniform downstream', async () => {
      requestId = 42;
      await post('register').send(CREDENTIALS);
      expect(auth.register.mock.calls[0][2]).toMatchObject({ correlationId: '42' });
    });

    it('leaves it undefined when the request carries no id', async () => {
      requestId = undefined;
      await post('register').send(CREDENTIALS);
      expect(auth.register.mock.calls[0][2].correlationId).toBeUndefined();
    });

    it('ignores an id of an unexpected type rather than coercing it', async () => {
      requestId = { nested: true };
      await post('register').send(CREDENTIALS);
      expect(auth.register.mock.calls[0][2].correlationId).toBeUndefined();
    });
  });

  describe('email verification endpoints', () => {
    it('redeems a token', async () => {
      const res = await post('verify-email').send({ token: 'tok' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'verified' });
      expect(auth.verifyEmail).toHaveBeenCalledWith('tok', expect.any(Object));
    });

    it('answers 202 to a resend request whatever the address', async () => {
      const res = await post('verify-email/resend').send({ email: CREDENTIALS.email });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'accepted' });
    });

    it('rejects a resend body carrying an unexpected field', async () => {
      const res = await post('verify-email/resend').send({
        email: CREDENTIALS.email,
        userId: 'someone-else',
      });
      expect(res.status).toBe(400);
    });
  });

  describe('password reset endpoints', () => {
    it('answers 202 to a reset request', async () => {
      const res = await post('password-reset').send({ email: CREDENTIALS.email });
      expect(res.status).toBe(202);
      expect(auth.requestPasswordReset).toHaveBeenCalledWith(
        CREDENTIALS.email,
        expect.any(Object),
      );
    });

    it('confirms a reset and clears the now-dead cookie', async () => {
      const res = await post('password-reset/confirm')
        .set('Cookie', [`${COOKIE}=tok-old`])
        .send({ token: 'tok', password: 'an-entirely-different-password' });
      expect(res.status).toBe(200);
      expect(auth.resetPassword).toHaveBeenCalledWith(
        'tok',
        'an-entirely-different-password',
        expect.any(Object),
      );
      // Reset revokes every session including this one; the cookie must not linger.
      expect(res.headers['set-cookie'][0]).toContain(`${COOKIE}=;`);
    });

    it('holds a reset to the same password policy as registration', async () => {
      const res = await post('password-reset/confirm').send({ token: 'tok', password: 'short' });
      expect(res.status).toBe(400);
    });
  });

  describe('session endpoints', () => {
    it('lists sessions for the cookie holder', async () => {
      auth.listSessions.mockResolvedValueOnce([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
          lastUsedAt: new Date(),
          expiresAt: new Date(),
          current: true,
        },
      ]);
      const res = await request(app.getHttpServer())
        .get('/auth/sessions')
        .set('Cookie', [`${COOKIE}=tok-old`]);
      expect(res.status).toBe(200);
      expect(res.body.sessions).toHaveLength(1);
      expect(auth.listSessions).toHaveBeenCalledWith(ACTOR, expect.any(Object));
    });

    it('resolves the actor from the cookie rather than trusting the body', async () => {
      await request(app.getHttpServer()).get('/auth/sessions').set('Cookie', [`${COOKIE}=tok-old`]);
      expect(auth.listSessions).toHaveBeenCalledWith(ACTOR, expect.any(Object));
    });

    it('revokes a named session', async () => {
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const res = await request(app.getHttpServer())
        .delete(`/auth/sessions/${id}`)
        .set('Cookie', [`${COOKIE}=tok-old`]);
      expect(res.status).toBe(204);
      expect(auth.revokeSession).toHaveBeenCalledWith(ACTOR, id, expect.any(Object));
    });

    it('rejects a session id that is not a uuid before reaching the service', async () => {
      const res = await request(app.getHttpServer())
        .delete('/auth/sessions/not-a-uuid')
        .set('Cookie', [`${COOKIE}=tok-old`]);
      expect(res.status).toBe(400);
      expect(auth.revokeSession).not.toHaveBeenCalled();
    });

    it('passes the resolved actor to revoke, never an id from the request body', async () => {
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await request(app.getHttpServer()).delete(`/auth/sessions/${id}`).send({ userId: 'someone-else' });
      expect(auth.revokeSession).toHaveBeenCalledWith(ACTOR, id, expect.any(Object));
    });
  });
});
