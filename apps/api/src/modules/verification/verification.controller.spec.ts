import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';

const ACTOR = testActor({ userId: 'u1', roles: ['STAFF'], staffScopes: ['VERIFICATION'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DOC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('verification controller', () => {
  let app: INestApplication;
  let verification: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    verification = {
      submit: vi.fn().mockResolvedValue({ id: ID }),
      listMine: vi.fn().mockResolvedValue([]),
      queue: vi
        .fn()
        .mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }),
      getForReview: vi.fn().mockResolvedValue({ id: ID }),
      decide: vi.fn().mockResolvedValue({ requestId: ID }),
      openDocument: vi
        .fn()
        .mockResolvedValue({ signedUrl: 'https://storage.test/x', expiresAt: new Date() }),
    };
    const mod = await Test.createTestingModule({
      controllers: [VerificationController],
      providers: [
        { provide: VerificationService, useValue: verification },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    // As bootstrap.ts installs them: implicit conversion off, so a query-string limit is only a
    // number because the DTO says so.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());

  describe('the applicant’s routes', () => {
    it('submits an application with documents', async () => {
      const res = await http()
        .post('/verification/me/requests')
        .send({ documentIds: [DOC] });
      expect(res.status).toBe(201);
      expect(verification['submit']).toHaveBeenCalledWith(
        ACTOR,
        { documentIds: [DOC] },
        expect.any(Object),
      );
    });

    it('lists the caller’s own applications', async () => {
      expect((await http().get('/verification/me/requests')).status).toBe(200);
      expect(verification['listMine']).toHaveBeenCalledWith(ACTOR, expect.any(Object));
    });

    it.each([
      ['no documents', { documentIds: [] }],
      ['a document id that is not a uuid', { documentIds: ['x'] }],
      ['more than ten documents', { documentIds: Array.from({ length: 11 }, () => DOC) }],
      // What was declared is read from the profile. A client cannot say it declared less.
      ['a declared scope', { documentIds: [DOC], declaredScope: { specialtyNodeIds: [] } }],
      ['a status', { documentIds: [DOC], status: 'APPROVED' }],
    ])('refuses %s', async (_label, body) => {
      expect((await http().post('/verification/me/requests').send(body)).status).toBe(400);
      expect(verification['submit']).not.toHaveBeenCalled();
    });
  });

  describe('the reviewer’s routes', () => {
    it('reads the queue, converting the limit and passing the cursor through', async () => {
      const res = await http().get('/verification/requests?limit=5&cursor=abc');
      expect(res.status).toBe(200);
      expect(verification['queue']).toHaveBeenCalledWith(
        ACTOR,
        { limit: 5, cursor: 'abc' },
        expect.any(Object),
      );
    });

    it.each([
      ['a limit that is not a number', '?limit=many'],
      ['an unknown filter', '?status=REJECTED'],
    ])('refuses a queue query with %s', async (_label, qs) => {
      expect((await http().get(`/verification/requests${qs}`)).status).toBe(400);
      expect(verification['queue']).not.toHaveBeenCalled();
    });

    it('reads one application', async () => {
      expect((await http().get(`/verification/requests/${ID}`)).status).toBe(200);
      expect(verification['getForReview']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
    });

    it('records a decision', async () => {
      const body = { outcome: 'REJECTED', reason: 'The licence has expired.' };
      const res = await http().post(`/verification/requests/${ID}/decision`).send(body);
      expect(res.status).toBe(201);
      expect(verification['decide']).toHaveBeenCalledWith(ACTOR, ID, body, expect.any(Object));
    });

    it.each([
      ['no reason', { outcome: 'APPROVED' }],
      ['a reason of spaces', { outcome: 'APPROVED', reason: '   ' }],
      ['a reason over 2000 characters', { outcome: 'APPROVED', reason: 'x'.repeat(2001) }],
      // Whole-application decisions only: there is no partial outcome to ask for.
      ['a partial outcome', { outcome: 'PARTIAL', reason: 'Only the city.' }],
      ['approved parts', { outcome: 'APPROVED', reason: 'Fine.', approvedAreaIds: [DOC] }],
      ['a chosen reviewer', { outcome: 'APPROVED', reason: 'Fine.', decidedBy: DOC }],
    ])('refuses a decision with %s', async (_label, body) => {
      expect((await http().post(`/verification/requests/${ID}/decision`).send(body)).status).toBe(
        400,
      );
      expect(verification['decide']).not.toHaveBeenCalled();
    });

    it('opens a document through its application, and forbids caching the link', async () => {
      const res = await http().get(`/verification/requests/${ID}/documents/${DOC}/delivery-url`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(verification['openDocument']).toHaveBeenCalledWith(ACTOR, ID, DOC, expect.any(Object));
    });

    it.each([
      [`/verification/requests/not-a-uuid`],
      [`/verification/requests/${ID}/documents/not-a-uuid/delivery-url`],
    ])('refuses an id that is not a uuid: %s', async (path) => {
      expect((await http().get(path)).status).toBe(400);
    });
  });
});
