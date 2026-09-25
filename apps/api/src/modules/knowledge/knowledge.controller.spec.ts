import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { KnowledgeDocumentsService } from './knowledge-documents.service';
import { KnowledgeController } from './knowledge.controller';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const VIEW = {
  docKey: 'kb-customer-quotes',
  version: 1,
  title: 'Quotes',
  locale: 'en',
  fallback: false,
  sections: [],
};

describe('knowledge controller (T-059)', () => {
  let app: INestApplication;
  let documents: { read: ReturnType<typeof vi.fn> };

  const build = async (actor: typeof ACTOR | null) => {
    documents = { read: vi.fn().mockResolvedValue(VIEW) };
    const mod = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        { provide: KnowledgeDocumentsService, useValue: documents },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (actor === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return actor;
            },
          },
        },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  };

  beforeEach(() => build(ACTOR));
  afterEach(async () => {
    await closeApp(app);
  });

  const get = (path: string) => request(app.getHttpServer()).get(path);

  it('opens an article in the language asked for', async () => {
    const res = await get('/knowledge/documents/kb-customer-quotes?locale=hy');
    expect([res.status, res.body]).toEqual([200, VIEW]);
    expect(documents.read).toHaveBeenCalledWith(
      ACTOR,
      'kb-customer-quotes',
      'hy',
      expect.any(Object),
    );
  });

  it.each([
    ['a key that is not a document key', '/knowledge/documents/..%2Fsecrets?locale=en'],
    ['a key with capitals', '/knowledge/documents/KB-customer?locale=en'],
    ['a key too long to be one', `/knowledge/documents/kb-${'a'.repeat(130)}?locale=en`],
  ])('answers %s as a document that does not exist', async (_label, path) => {
    expect((await get(path)).status).toBe(404);
    expect(documents.read).not.toHaveBeenCalled();
  });

  it.each([
    ['no language', '/knowledge/documents/kb-customer-quotes'],
    [
      'a language the knowledge base does not have',
      '/knowledge/documents/kb-customer-quotes?locale=de',
    ],
    ['an audience', '/knowledge/documents/kb-customer-quotes?locale=en&audience=staff'],
  ])('refuses %s', async (_label, path) => {
    expect((await get(path)).status).toBe(400);
    expect(documents.read).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not signed in', async () => {
    await closeApp(app);
    await build(null);
    expect((await get('/knowledge/documents/kb-customer-quotes?locale=en')).status).toBe(401);
  });
});
