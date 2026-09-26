import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../../test/actor';
import { workspaceResolverStub } from '../../../../test/context';
import { closeApp, listenOnce } from '../../../../test/http';
import { ActorService } from '../../../common/authz/actor.service';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppExceptionFilter } from '../../../common/errors/http-exception.filter';
import { DiscoveryAnswerController } from './discovery-answer.controller';
import { DiscoveryAnswerService } from './discovery-answer.service';
import { validationPipe } from '../../../common/validation/pipe';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const ANSWER = { status: 'no_results', locale: 'en', results: [] };
const NODE = '0b6f3c1e-8d2a-4f5b-9c7e-1a2b3c4d5e6f';

describe('discovery assistant controller (T-018)', () => {
  let app: INestApplication;
  let discovery: { answer: ReturnType<typeof vi.fn> };

  const build = async (actor: typeof ACTOR | null) => {
    discovery = { answer: vi.fn().mockResolvedValue(ANSWER) };
    const mod = await Test.createTestingModule({
      controllers: [DiscoveryAnswerController],
      providers: [
        { provide: DiscoveryAnswerService, useValue: discovery },
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
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  };

  beforeEach(() => build(ACTOR));
  afterEach(async () => {
    await closeApp(app);
  });

  const post = (body: object) =>
    request(app.getHttpServer()).post('/ai/discovery/answer').send(body);

  it('passes the request through, with the point in the body and nothing the caller did not send', async () => {
    const res = await post({
      question: 'Who is nearest to me?',
      locale: 'hy',
      near: { lon: 44.51, lat: 40.18 },
      radiusKm: 20,
      taxonomyNodeIds: [NODE],
      purpose: 'Serving court papers',
    });
    expect([res.status, res.body]).toEqual([200, ANSWER]);
    expect(discovery.answer).toHaveBeenCalledWith(
      ACTOR,
      {
        question: 'Who is nearest to me?',
        locale: 'hy',
        near: { lon: 44.51, lat: 40.18 },
        radiusKm: 20,
        taxonomyNodeIds: [NODE],
        purpose: 'Serving court papers',
      },
      expect.objectContaining({ userAgent: undefined }),
    );

    await post({ question: 'Anyone in Gyumri?' });
    expect(discovery.answer.mock.calls[1]![1]).toEqual({
      question: 'Anyone in Gyumri?',
      locale: undefined,
      near: undefined,
      radiusKm: undefined,
      taxonomyNodeIds: undefined,
      purpose: undefined,
    });
  });

  it.each([
    ['no question', {}],
    ['a question too short to be one', { question: 'hi' }],
    ['a language the assistant does not write', { question: 'Anyone?', locale: 'de' }],
    ['a point off the globe', { question: 'Anyone?', near: { lon: 200, lat: 0 } }],
    ['a radius beyond the maximum', { question: 'Anyone?', radiusKm: 101 }],
    ['a specialty that is not an id', { question: 'Anyone?', taxonomyNodeIds: ['fraud'] }],
    ['somebody else’s identity', { question: 'Anyone?', userId: 'u2' }],
    ['a workspace of its choosing', { question: 'Anyone?', workspaceId: 'w2' }],
  ])('refuses %s before the assistant sees it', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(discovery.answer).not.toHaveBeenCalled();
  });

  it('is for signed-in callers only', async () => {
    await closeApp(app);
    await build(null);
    expect((await post({ question: 'Anyone in Gyumri?' })).status).toBe(401);
  });
});
