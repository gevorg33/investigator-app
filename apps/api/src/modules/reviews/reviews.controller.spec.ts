import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { ReviewModerationController } from './review-moderation.controller';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';
import { validationPipe } from '../../common/validation/pipe';

const ASSIGNMENT = '00000000-0000-4000-8000-0000000000a7';
const PROFILE = '00000000-0000-4000-8000-0000000000b7';
const TEXT = '00000000-0000-4000-8000-0000000000c7';
const REVIEW = '00000000-0000-4000-8000-0000000000d7';
const customer = testActor({ userId: '00000000-0000-4000-8000-0000000000e7', roles: ['CUSTOMER'] });
const review = `/api/v1/assignments/${ASSIGNMENT}/review`;

/** What the review routes accept before the service is reached (T-037). Who may is the service's. */
describe('review routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (
    reviews: Partial<ReviewsService>,
    who: ReturnType<typeof testActor> | null = customer,
  ) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReviewsController, ReviewModerationController],
      providers: [
        { provide: ReviewsService, useValue: reviews },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (who === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return who;
            },
          },
        },
        workspaceResolverStub(who ?? customer),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('refuses anyone not signed in', async () => {
    const getForParty = vi.fn();
    const forProfile = vi.fn();
    const queue = vi.fn();
    app = await make({ getForParty, forProfile, queue }, null);
    const http = request(app.getHttpServer());
    expect((await http.get(review)).status).toBe(401);
    expect((await http.get(`/api/v1/profiles/investigator/${PROFILE}/reviews`)).status).toBe(401);
    expect((await http.get('/api/v1/review-moderation')).status).toBe(401);
    expect(getForParty).not.toHaveBeenCalled();
    expect(forProfile).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it('routes every action to the service, with the caller and the ids from the path', async () => {
    const view = { id: REVIEW };
    const create = vi.fn().mockResolvedValue(view);
    const getForParty = vi.fn().mockResolvedValue(view);
    const respond = vi.fn().mockResolvedValue(view);
    const report = vi.fn().mockResolvedValue(view);
    const forProfile = vi
      .fn()
      .mockResolvedValue({ summary: { count: 0, average: null }, items: [] });
    const queue = vi.fn().mockResolvedValue({ items: [] });
    const moderate = vi.fn().mockResolvedValue({ id: TEXT, status: 'PUBLISHED' });
    const remove = vi.fn().mockResolvedValue(view);
    app = await make({ create, getForParty, respond, report, forProfile, queue, moderate, remove });
    const http = request(app.getHttpServer());

    expect((await http.post(review).send({ rating: 5, text: 'Good.' })).status).toBe(201);
    expect((await http.get(review)).status).toBe(200);
    expect((await http.post(`${review}/response`).send({ text: 'Thanks.' })).status).toBe(201);
    expect(
      (
        await http
          .post(`${review}/report`)
          .send({ part: 'RESPONSE', reason: 'It names my client.' })
      ).status,
    ).toBe(200);
    expect(
      (await http.get(`/api/v1/profiles/investigator/${PROFILE}/reviews?limit=10&cursor=abc`))
        .status,
    ).toBe(200);
    expect((await http.get('/api/v1/review-moderation?limit=5')).status).toBe(200);
    expect(
      (await http.post(`/api/v1/review-moderation/texts/${TEXT}`).send({ decision: 'PUBLISH' }))
        .status,
    ).toBe(200);
    expect(
      (
        await http
          .post(`/api/v1/review-moderation/reviews/${REVIEW}/remove`)
          .send({ reason: 'Removed after a verified complaint.' })
      ).status,
    ).toBe(200);

    expect(create.mock.calls[0]?.slice(0, 3)).toEqual([
      customer,
      ASSIGNMENT,
      { rating: 5, text: 'Good.' },
    ]);
    expect(getForParty.mock.calls[0]?.slice(0, 2)).toEqual([customer, ASSIGNMENT]);
    expect(respond.mock.calls[0]?.slice(1, 3)).toEqual([ASSIGNMENT, { text: 'Thanks.' }]);
    expect(report.mock.calls[0]?.[1]).toBe(ASSIGNMENT);
    expect(forProfile.mock.calls[0]?.slice(1, 3)).toEqual([PROFILE, { limit: 10, cursor: 'abc' }]);
    expect(queue.mock.calls[0]?.[1]).toEqual({ limit: 5, cursor: undefined });
    expect(moderate.mock.calls[0]?.slice(1, 3)).toEqual([TEXT, { decision: 'PUBLISH' }]);
    expect(remove.mock.calls[0]?.[1]).toBe(REVIEW);
  });

  it.each([
    ['no rating', {}],
    ['a rating of 0', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['half a star', { rating: 4.5 }],
    ['a rating as words', { rating: 'five' }],
    ['words too long to be a review', { rating: 4, text: 'x'.repeat(2001) }],
    // The ranking input is computed, never client-supplied — and neither is anything else the
    // server decides.
    ['an average', { rating: 4, average: 5 }],
    ['a review count', { rating: 4, count: 100 }],
    ['the investigator reviewed', { rating: 4, investigatorProfileId: PROFILE }],
    ['a workspace', { rating: 4, customerTenantId: PROFILE }],
    ['a status for the words', { rating: 4, text: 'Fine.', status: 'PUBLISHED' }],
    ['another assignment', { rating: 4, assignmentId: PROFILE }],
  ])('refuses a review with %s', async (_what, body) => {
    const create = vi.fn();
    app = await make({ create });
    expect((await request(app.getHttpServer()).post(review).send(body)).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['a response with no words', `${review}/response`, {}],
    [
      'a report of a part that does not exist',
      `${review}/report`,
      { part: 'RATING', reason: 'Not accurate at all.' },
    ],
    [
      'a report with no reason worth reading',
      `${review}/report`,
      { part: 'REVIEW', reason: 'bad' },
    ],
    [
      'a decision that is not one',
      `/api/v1/review-moderation/texts/${TEXT}`,
      { decision: 'DELETE' },
    ],
    [
      'a removal with too short a reason',
      `/api/v1/review-moderation/reviews/${REVIEW}/remove`,
      { reason: 'spam' },
    ],
  ])('refuses %s', async (_what, path, body) => {
    const respond = vi.fn();
    const report = vi.fn();
    const moderate = vi.fn();
    const remove = vi.fn();
    app = await make({ respond, report, moderate, remove });
    expect((await request(app.getHttpServer()).post(path).send(body)).status).toBe(400);
    for (const fn of [respond, report, moderate, remove]) expect(fn).not.toHaveBeenCalled();
  });

  it('refuses ids that are not ids, and a limit that is not a number', async () => {
    const getForParty = vi.fn();
    const forProfile = vi.fn();
    app = await make({ getForParty, forProfile });
    const http = request(app.getHttpServer());
    expect((await http.get('/api/v1/assignments/latest/review')).status).toBe(400);
    expect((await http.get('/api/v1/profiles/investigator/me/reviews')).status).toBe(400);
    expect(
      (await http.get(`/api/v1/profiles/investigator/${PROFILE}/reviews?limit=all`)).status,
    ).toBe(400);
    expect(getForParty).not.toHaveBeenCalled();
    expect(forProfile).not.toHaveBeenCalled();
  });
});
