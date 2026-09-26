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
import { AssistantController } from './assistant.controller';
import { KnowledgeAnswerService } from './knowledge-answer.service';
import { validationPipe } from '../../common/validation/pipe';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const ANSWER = { status: 'no_answer', answer: null, citations: [], locale: 'en', fallback: false };

describe('assistant controller (T-017)', () => {
  let app: INestApplication;
  let answers: { answer: ReturnType<typeof vi.fn> };

  const build = async (actor: typeof ACTOR | null) => {
    answers = { answer: vi.fn().mockResolvedValue(ANSWER) };
    const mod = await Test.createTestingModule({
      controllers: [AssistantController],
      providers: [
        { provide: KnowledgeAnswerService, useValue: answers },
        {
          provide: ActorService,
          // As the real one: no valid session is an error, never a null actor.
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
    request(app.getHttpServer()).post('/ai/knowledge/answer').send(body);

  it('answers a question, in the language asked for or the user’s own', async () => {
    const res = await post({ question: 'How long does a quote last?', locale: 'hy' });
    expect([res.status, res.body]).toEqual([200, ANSWER]);
    expect(answers.answer).toHaveBeenCalledWith(
      ACTOR,
      { question: 'How long does a quote last?', locale: 'hy' },
      expect.any(Object),
    );
    await post({ question: 'How long does a quote last?' });
    expect(answers.answer).toHaveBeenLastCalledWith(
      ACTOR,
      { question: 'How long does a quote last?', locale: undefined },
      expect.any(Object),
    );
  });

  it.each([
    ['no question', {}],
    ['a question too short to be one', { question: 'hi' }],
    ['a question longer than 2000 characters', { question: 'x'.repeat(2001) }],
    ['a language the knowledge base does not have', { question: 'How long?', locale: 'de' }],
    // The caller does not choose who they read as, or which documents count.
    ['an audience', { question: 'How long?', audience: 'staff' }],
    ['a visibility', { question: 'How long?', visibility: 'staff' }],
    ['a workspace', { question: 'How long?', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
  ])('refuses %s', async (_label, body) => {
    expect((await post(body)).status).toBe(400);
    expect(answers.answer).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not signed in', async () => {
    await closeApp(app);
    await build(null);
    expect((await post({ question: 'How long?' })).status).toBe(401);
    expect(answers.answer).not.toHaveBeenCalled();
  });
});
