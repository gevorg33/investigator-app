import { Module, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeApp, listenOnce } from '../../../test/http';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { ActorService } from '../../common/authz/actor.service';
import { LegalController } from './legal.controller';
import { LegalService, type PublishedDocument } from './legal.service';

/**
 * The one thing a client can do with this before it has an account: read the terms (T-021).
 *
 * Unauthenticated on purpose — registration cannot complete without accepting them, so they
 * have to be readable first.
 */
const published = (over: Partial<PublishedDocument> = {}): PublishedDocument => ({
  id: '00000000-0000-4000-8000-000000000001',
  type: 'TERMS_OF_SERVICE',
  version: 3,
  locale: 'en',
  title: 'Terms of service',
  content: 'The agreement, in full.',
  contentHash: 'a'.repeat(64),
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  authoritative: true,
  ...over,
});

const actor = testActor({ userId: '00000000-0000-4000-8000-0000000000d1' });

describe('GET /api/v1/legal/documents/:type', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (service: Partial<LegalService>): Promise<INestApplication> => {
    @Module({
      controllers: [LegalController],
      providers: [
        { provide: LegalService, useValue: service },
        // Two of these routes are behind the guard now (T-022): reading what is outstanding, and
        // accepting it. The guard's own behaviour is actor.service.spec.ts's subject.
        { provide: ActorService, useValue: { fromRefreshToken: async () => actor } },
        workspaceResolverStub(actor),
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    const created = moduleRef.createNestApplication();
    created.setGlobalPrefix('api/v1');
    created.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    created.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(created);
    return created;
  };

  it('returns the current version: the text, and the hash a consent record would copy', async () => {
    const currentDocument = vi.fn().mockResolvedValue(published());
    app = await make({ currentDocument });

    const res = await request(app.getHttpServer()).get('/api/v1/legal/documents/TERMS_OF_SERVICE');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      type: 'TERMS_OF_SERVICE',
      version: 3,
      locale: 'en',
      title: 'Terms of service',
      content: 'The agreement, in full.',
      contentHash: 'a'.repeat(64),
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      authoritative: true,
    });
  });

  it('asks for the locale the reader wants', async () => {
    const currentDocument = vi
      .fn()
      .mockResolvedValue(published({ locale: 'hy', authoritative: false }));
    app = await make({ currentDocument });

    const res = await request(app.getHttpServer()).get(
      '/api/v1/legal/documents/TERMS_OF_SERVICE?locale=hy',
    );

    expect(currentDocument).toHaveBeenCalledWith('TERMS_OF_SERVICE', 'hy');
    expect(res.body).toMatchObject({ locale: 'hy', authoritative: false });
  });

  it('needs no session: the terms are readable before an account exists', async () => {
    app = await make({ currentDocument: vi.fn().mockResolvedValue(published()) });
    // No Authorization header, no cookie, no workspace.
    const res = await request(app.getHttpServer()).get('/api/v1/legal/documents/TERMS_OF_SERVICE');
    expect(res.status).toBe(200);
  });

  it('answers a type that does not exist with 404, asking the service nothing', async () => {
    const currentDocument = vi.fn();
    app = await make({ currentDocument });

    const res = await request(app.getHttpServer()).get('/api/v1/legal/documents/NOT_A_DOCUMENT');

    expect(res.status).toBe(404);
    expect(currentDocument).not.toHaveBeenCalled();
  });

  it('passes the service’s 404 through when nothing is published yet', async () => {
    const { AppError } = await import('../../common/errors/app-error');
    app = await make({ currentDocument: vi.fn().mockRejectedValue(AppError.notFound()) });

    const res = await request(app.getHttpServer()).get('/api/v1/legal/documents/AGENCY_AGREEMENT');

    expect(res.status).toBe(404);
  });
});

describe('what an account still has to accept', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const withRoles = async (roles: ReadonlyArray<'CUSTOMER' | 'INVESTIGATOR' | 'STAFF'>, legal: Partial<LegalService>) => {
    const who = testActor({ userId: actor.userId, roles });
    const moduleRef = await Test.createTestingModule({
      controllers: [LegalController],
      providers: [
        { provide: LegalService, useValue: legal },
        { provide: ActorService, useValue: { fromRefreshToken: async () => who } },
        workspaceResolverStub(who),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('lists what is outstanding, asking for the roles the caller holds', async () => {
    const outstanding = vi.fn().mockResolvedValue([published({ type: 'LAWFUL_USE_POLICY' })]);
    app = await withRoles(['INVESTIGATOR'], { outstanding });

    const res = await request(app.getHttpServer()).get('/api/v1/legal/outstanding');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ type: 'LAWFUL_USE_POLICY' })]);
    // Registration's documents plus the investigator's, asked for once each.
    const [, types] = outstanding.mock.calls[0] as [string, string[]];
    expect(types).toEqual([
      'PRIVACY_POLICY',
      'TERMS_OF_SERVICE',
      'INVESTIGATOR_AGREEMENT',
      'LAWFUL_USE_POLICY',
    ]);
  });

  it('asks only for registration’s documents when the account holds no role', async () => {
    const outstanding = vi.fn().mockResolvedValue([]);
    app = await withRoles([], { outstanding });

    const res = await request(app.getHttpServer()).get('/api/v1/legal/outstanding');

    expect(res.body).toEqual([]);
    const [, types] = outstanding.mock.calls[0] as [string, string[]];
    expect(types).toEqual(['PRIVACY_POLICY', 'TERMS_OF_SERVICE']);
  });

  it('records a re-acceptance and answers that nothing is left', async () => {
    const requireAcceptance = vi.fn().mockResolvedValue(undefined);
    app = await withRoles(['CUSTOMER'], { requireAcceptance });

    const res = await request(app.getHttpServer())
      .post('/api/v1/legal/acceptances')
      .send({ acceptedDocumentIds: ['00000000-0000-4000-8000-0000000000e1'] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ outstanding: [] });
    expect(requireAcceptance).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'REACCEPTANCE' }),
      expect.anything(),
    );
  });

  it('refuses an acceptance that names nothing', async () => {
    const requireAcceptance = vi.fn();
    app = await withRoles(['CUSTOMER'], { requireAcceptance });

    const res = await request(app.getHttpServer())
      .post('/api/v1/legal/acceptances')
      .send({ acceptedDocumentIds: [] });

    expect(res.status).toBe(400);
    expect(requireAcceptance).not.toHaveBeenCalled();
  });
});
