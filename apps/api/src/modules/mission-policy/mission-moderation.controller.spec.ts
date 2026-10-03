import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { validationPipe } from '../../common/validation/pipe';
import { MissionModerationController } from './mission-moderation.controller';
import { MissionModerationService } from './mission-moderation.service';
import { NOTE_MAX, REASON_MAX } from './mission-moderation.policy';

const ID = '00000000-0000-4000-8000-0000000000c1';
const moderator = testActor({
  userId: '00000000-0000-4000-8000-0000000000c2',
  roles: ['STAFF'],
  staffScopes: ['MODERATION'],
});
const BODY = { outcome: 'REJECTED', reason: 'Name the company you need checked.', version: 3 };

/** What the routes accept before the service is reached (T-051). Who may decide is the service's. */
describe('moderation routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (moderation: Partial<MissionModerationService>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MissionModerationController],
      providers: [
        { provide: MissionModerationService, useValue: moderation },
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

  it('pages the queue, reads one mission and decides it — with the caller, and kept out of caches', async () => {
    const s = {
      queue: vi
        .fn()
        .mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }),
      getForReview: vi.fn().mockResolvedValue({ id: ID }),
      decide: vi.fn().mockResolvedValue({ outcome: 'REJECTED' }),
    };
    app = await make(s);
    const http = request(app.getHttpServer());

    const queue = await http.get('/api/v1/moderation/missions?limit=10&cursor=abc');
    expect(queue.status).toBe(200);
    expect(queue.headers['cache-control']).toBe('no-store');
    expect(s.queue.mock.calls[0]?.slice(0, 2)).toEqual([moderator, { limit: 10, cursor: 'abc' }]);

    const one = await http.get(`/api/v1/moderation/missions/${ID}`);
    expect(one.status).toBe(200);
    expect(one.headers['cache-control']).toBe('no-store');
    expect(s.getForReview.mock.calls[0]?.slice(0, 2)).toEqual([moderator, ID]);

    const withNote = { ...BODY, internalNote: 'Reads like a partner check.' };
    expect(
      (await http.post(`/api/v1/moderation/missions/${ID}/decision`).send(withNote)).status,
    ).toBe(201);
    expect(s.decide.mock.calls[0]?.slice(0, 3)).toEqual([moderator, ID, withNote]);
  });

  it('reads the latency report over the period asked for, kept out of caches — and refuses any other period', async () => {
    const latency = vi.fn().mockResolvedValue({ days: 90, rows: [] });
    const getForReview = vi.fn();
    app = await make({ latency, getForReview });
    const http = request(app.getHttpServer());

    const res = await http.get('/api/v1/moderation/missions/latency');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await http.get('/api/v1/moderation/missions/latency?days=30')).status).toBe(200);
    expect(latency.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      [moderator, {}],
      [moderator, { days: 30 }],
    ]);
    // Never read as a mission id.
    expect(getForReview).not.toHaveBeenCalled();
    for (const days of ['7', 'all', '-90']) {
      expect((await http.get(`/api/v1/moderation/missions/latency?days=${days}`)).status).toBe(400);
    }
    expect(latency).toHaveBeenCalledTimes(2);
  });

  it('answers a malformed id as a bad request, before the service', async () => {
    const getForReview = vi.fn();
    app = await make({ getForReview });
    expect(
      (await request(app.getHttpServer()).get('/api/v1/moderation/missions/nope')).status,
    ).toBe(400);
    expect(getForReview).not.toHaveBeenCalled();
  });

  it.each([
    ['no outcome', { outcome: undefined }],
    ['an outcome that does not exist', { outcome: 'APPROVED' }],
    ['no reason', { reason: undefined }],
    ['a reason of spaces', { reason: '   ' }],
    ['a reason too long to read', { reason: 'x'.repeat(REASON_MAX + 1) }],
    ['an internal note of spaces', { internalNote: '  ' }],
    ['an empty internal note', { internalNote: '' }],
    ['an internal note too long', { internalNote: 'x'.repeat(NOTE_MAX + 1) }],
    ['no version', { version: undefined }],
    ['a version below one', { version: 0 }],
    ['a moderator the client chose', { decidedBy: ID }],
    ['a band the client chose', { riskBand: 'STANDARD' }],
  ])('refuses %s', async (_what, over) => {
    const decide = vi.fn();
    app = await make({ decide });
    const res = await request(app.getHttpServer())
      .post(`/api/v1/moderation/missions/${ID}/decision`)
      .send({ ...BODY, ...over });
    expect(res.status).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });
});
