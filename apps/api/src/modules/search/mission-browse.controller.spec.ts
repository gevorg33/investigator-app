import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { MissionBrowseController } from './mission-browse.controller';
import { MissionBrowseService } from './mission-browse.service';

const ACTOR = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const EMPTY = { items: [], pageInfo: { nextCursor: null, hasNextPage: false } };
const ID = '5f2fa585-07bb-4514-94f1-981e74b48242';

describe('mission browse controller', () => {
  let app: INestApplication;
  let browse: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    browse = {
      browse: vi.fn().mockResolvedValue(EMPTY),
      listSaved: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue({ id: ID }),
      removeSaved: vi.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      controllers: [MissionBrowseController],
      providers: [
        { provide: MissionBrowseService, useValue: browse },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());

  it('answers a browse with 200, passing every filter through', async () => {
    const body = {
      taxonomyNodeIds: [ID],
      currency: 'AMD',
      budgetMinMinor: 1000,
      budgetMaxMinor: 5000,
      deadlineFrom: '2026-10-01',
      deadlineTo: '2026-12-31',
      serviceAreaId: ID,
      withinKm: 25,
      languages: ['en', 'hy'],
      postedWithinDays: 7,
      sort: 'budget',
      limit: 10,
    };
    const res = await http().post('/search/missions').send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(EMPTY);
    expect(browse['browse']).toHaveBeenCalledWith(ACTOR, body, expect.any(Object));
  });

  it.each([
    ['a status — eligibility is not a filter', { status: 'DRAFT' }],
    ['tags, which do not exist yet (T-055)', { tags: ['x'] }],
    ['an unknown sort', { sort: 'cheapest' }],
    ['a distance past the ceiling', { withinKm: 201 }],
    ['a malformed date', { deadlineTo: '31/12/2026' }],
    ['a malformed currency', { currency: 'dram' }],
    ['a negative budget', { budgetMinMinor: -1 }],
    ['text that is too long', { q: 'x'.repeat(201) }],
    ['posted within a day count of zero', { postedWithinDays: 0 }],
  ])('refuses %s', async (_, body) => {
    const res = await http().post('/search/missions').send(body);
    expect(res.status).toBe(400);
    expect(browse['browse']).not.toHaveBeenCalled();
  });

  it('lists, saves and deletes saved searches', async () => {
    expect((await http().get('/search/missions/saved')).body).toEqual({ items: [] });

    const save = { name: 'Yerevan due diligence', filters: { languages: ['hy'], sort: 'newest' } };
    const created = await http().post('/search/missions/saved').send(save);
    expect(created.status).toBe(201);
    expect(browse['save']).toHaveBeenCalledWith(ACTOR, save, expect.any(Object));

    expect((await http().delete(`/search/missions/saved/${ID}`)).status).toBe(204);
    expect(browse['removeSaved']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  it.each([
    ['no name', { filters: {} }],
    ['a paging argument inside the filters', { name: 'n', filters: { cursor: 'abc' } }],
    ['an invalid filter', { name: 'n', filters: { sort: 'cheapest' } }],
  ])('refuses to save with %s', async (_, body) => {
    expect((await http().post('/search/missions/saved').send(body)).status).toBe(400);
    expect(browse['save']).not.toHaveBeenCalled();
  });

  it('refuses to delete by anything but an id', async () => {
    expect((await http().delete('/search/missions/saved/not-an-id')).status).toBe(400);
  });
});
