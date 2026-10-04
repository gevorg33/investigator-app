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
import { LegalHoldController } from './legal-hold.controller';
import { REASON_MAX, REASON_MIN } from './legal-hold.policy';
import { LegalHoldService } from './legal-hold.service';

const ID = '00000000-0000-4000-8000-0000000000d1';
const RESOURCE = '00000000-0000-4000-8000-0000000000d3';
const compliance = testActor({
  userId: '00000000-0000-4000-8000-0000000000d2',
  roles: ['STAFF'],
  staffScopes: ['COMPLIANCE'],
});
const REASON = 'Preservation request PR-2026-114.';
const PLACE = { resourceType: 'USER', resourceId: RESOURCE, reason: REASON };

/** What the routes accept before the service is reached (T-035). Who may is the service's. */
describe('legal hold routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (holds: Partial<LegalHoldService>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LegalHoldController],
      providers: [
        { provide: LegalHoldService, useValue: holds },
        { provide: ActorService, useValue: { fromRefreshToken: async () => compliance } },
        workspaceResolverStub(compliance),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('lists, places and releases — with the caller, and the list kept out of caches', async () => {
    const s = {
      list: vi
        .fn()
        .mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }),
      place: vi.fn().mockResolvedValue({ id: ID }),
      release: vi.fn().mockResolvedValue({ id: ID }),
    };
    app = await make(s);
    const http = request(app.getHttpServer());

    const list = await http.get(
      `/api/v1/legal-holds?resourceType=USER&resourceId=${RESOURCE}&status=ALL&limit=10&cursor=abc`,
    );
    expect(list.status).toBe(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(s.list.mock.calls[0]?.slice(0, 2)).toEqual([
      compliance,
      { resourceType: 'USER', resourceId: RESOURCE, status: 'ALL', limit: 10, cursor: 'abc' },
    ]);

    expect((await http.post('/api/v1/legal-holds').send(PLACE)).status).toBe(201);
    expect(s.place.mock.calls[0]?.slice(0, 2)).toEqual([compliance, PLACE]);

    const released = await http.post(`/api/v1/legal-holds/${ID}/release`).send({ reason: REASON });
    expect(released.status).toBe(200);
    expect(s.release.mock.calls[0]?.slice(0, 3)).toEqual([compliance, ID, { reason: REASON }]);
  });

  it.each([
    ['an unknown resource type', { ...PLACE, resourceType: 'EVIDENCE_ITEM' }],
    ['a resource id that is not one', { ...PLACE, resourceId: 'nope' }],
    ['no reason', { resourceType: 'USER', resourceId: RESOURCE }],
    ['a reason too short to say which request', { ...PLACE, reason: 'x'.repeat(REASON_MIN - 1) }],
    ['a reason of spaces', { ...PLACE, reason: ' '.repeat(REASON_MIN) }],
    ['a reason over the limit', { ...PLACE, reason: 'x'.repeat(REASON_MAX + 1) }],
  ])('refuses to place a hold with %s, before the service', async (_, body) => {
    const place = vi.fn();
    app = await make({ place });
    expect((await request(app.getHttpServer()).post('/api/v1/legal-holds').send(body)).status).toBe(
      400,
    );
    expect(place).not.toHaveBeenCalled();
  });

  it('refuses a release without a reason, or of an id that is not one, before the service', async () => {
    const release = vi.fn();
    app = await make({ release });
    const http = request(app.getHttpServer());
    expect((await http.post(`/api/v1/legal-holds/${ID}/release`).send({})).status).toBe(400);
    expect(
      (await http.post('/api/v1/legal-holds/nope/release').send({ reason: REASON })).status,
    ).toBe(400);
    expect(release).not.toHaveBeenCalled();
  });

  it.each([
    ['an unknown status', 'status=OPEN'],
    ['an unknown resource type', 'resourceType=EVIDENCE_ITEM'],
    ['a resource id that is not one', 'resourceId=nope'],
    ['a limit that is not a number', 'limit=many'],
  ])('refuses a list with %s, before the service', async (_, query) => {
    const list = vi.fn();
    app = await make({ list });
    expect((await request(app.getHttpServer()).get(`/api/v1/legal-holds?${query}`)).status).toBe(
      400,
    );
    expect(list).not.toHaveBeenCalled();
  });
});
