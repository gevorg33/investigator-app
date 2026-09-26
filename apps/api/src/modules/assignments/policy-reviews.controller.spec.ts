import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { PolicyRefusalService } from './policy-refusal.service';
import { PolicyReviewsController } from './policy-reviews.controller';
import { validationPipe } from '../../common/validation/pipe';

const ID = '00000000-0000-4000-8000-0000000000a5';
const moderator = testActor({
  userId: '00000000-0000-4000-8000-0000000000b5',
  roles: ['STAFF'],
  staffScopes: ['MODERATION'],
});
const REASONING = 'The material was obtained unlawfully; the investigator was right to stop';

/** What the routes accept before the service is reached (T-050). Who may decide is the service's. */
describe('policy review routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (refusal: Partial<PolicyRefusalService>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PolicyReviewsController],
      providers: [
        { provide: PolicyRefusalService, useValue: refusal },
        { provide: ActorService, useValue: { fromRefreshToken: async () => moderator } },
        workspaceResolverStub(moderator),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('pages the queue, reads the caller’s record, and resolves — with the caller', async () => {
    const s = {
      queue: vi
        .fn()
        .mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }),
      myResponseRecord: vi
        .fn()
        .mockResolvedValue({ counted: 0, excused: 0, pending: 0, badFaith: 0 }),
      resolve: vi.fn().mockResolvedValue({ id: ID }),
    };
    app = await make(s);
    const http = request(app.getHttpServer());

    expect((await http.get('/api/v1/policy-reviews?limit=10')).status).toBe(200);
    expect(s.queue.mock.calls[0]?.slice(0, 2)).toEqual([
      moderator,
      { limit: 10, cursor: undefined },
    ]);
    expect((await http.get('/api/v1/policy-reviews/response-record/me')).status).toBe(200);
    expect(s.myResponseRecord).toHaveBeenCalledTimes(1);

    const body = {
      finding: 'UNSUBSTANTIATED',
      disposition: 'CANCEL',
      reasoning: REASONING,
      money: { decision: 'SPLIT', investigatorAmountMinor: 500, reason: 'Half was done lawfully' },
    };
    expect((await http.post(`/api/v1/policy-reviews/${ID}/resolve`).send(body)).status).toBe(200);
    expect(s.resolve.mock.calls[0]?.slice(0, 3)).toEqual([moderator, ID, body]);
  });

  it.each([
    ['a finding that does not exist', { finding: 'MAYBE' }],
    ['no reasoning', { reasoning: undefined }],
    ['reasoning too short to review', { reasoning: 'no' }],
    ['a disposition that does not exist', { disposition: 'IGNORE' }],
    [
      'a money decision staff may not make',
      { money: { decision: 'RESUME', reason: 'Back to it' } },
    ],
    [
      'a negative split',
      { money: { decision: 'SPLIT', investigatorAmountMinor: -1, reason: 'Odd' } },
    ],
    ['a money decision with no reason', { money: { decision: 'FULL_REFUND' } }],
    ['a decided-by the client chose', { decidedBy: ID }],
  ])('refuses %s', async (_what, over) => {
    const resolve = vi.fn();
    app = await make({ resolve });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/policy-reviews/${ID}/resolve`)
      .send({ finding: 'SUBSTANTIATED', disposition: 'RESUME', reasoning: REASONING, ...over });
    expect(res.status).toBe(400);
    expect(resolve).not.toHaveBeenCalled();
  });
});
