import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { ActorService } from '../../common/authz/actor.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const EMPTY = { items: [], pageInfo: { nextCursor: null, hasNextPage: false } };

describe('search controller', () => {
  let app: INestApplication;
  let search: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    search = { searchInvestigators: vi.fn().mockResolvedValue(EMPTY) };
    const mod = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [
        { provide: SearchService, useValue: search },
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
  const post = (body: unknown) => http().post('/search/investigators').send(body);

  it('answers a search with 200, because it creates nothing', async () => {
    expect((await post({})).status).toBe(200);
    expect(search['searchInvestigators']).toHaveBeenCalledWith(ACTOR, {}, expect.any(Object));
  });

  it('takes coordinates in the body, never in the URL', async () => {
    // A location search carries a customer's coordinates. In a query string they reach access
    // logs, referrers and analytics (postgis-search).
    const body = { near: { lon: 44.52, lat: 40.19 }, radiusKm: 25 };
    expect((await post(body)).status).toBe(200);
    expect(search['searchInvestigators']).toHaveBeenCalledWith(ACTOR, body, expect.any(Object));
    // And there is no GET that could take them another way.
    expect((await http().get('/search/investigators?lon=44.52&lat=40.19')).status).toBe(404);
  });

  it('passes every supported filter through', async () => {
    const body = {
      countryCode: 'AM',
      region: 'Shirak',
      city: 'Gyumri',
      languages: ['hy', 'en'],
      taxonomyNodeIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      availableDuring: { dayOfWeek: 1, startMinute: 540, endMinute: 720 },
      pricingModel: 'HOURLY',
      limit: 10,
    };
    expect((await post(body)).status).toBe(200);
    expect(search['searchInvestigators']).toHaveBeenCalledWith(ACTOR, body, expect.any(Object));
  });

  it('clamps an oversized limit rather than rejecting it', async () => {
    // docs/api/pagination.md is explicit about this, so the DTO must not cap it — the service
    // clamps. A 400 here would be the endpoint disagreeing with its own contract.
    expect((await post({ limit: 5000 })).status).toBe(200);
  });

  describe('the filter set is closed', () => {
    it.each([
      ['a verification filter', { verificationStatus: 'UNVERIFIED' }],
      ['a free-text query', { q: 'someone good with fraud' }],
      ['a relevance hint', { relevanceHint: 'fraud' }],
      ['a raw sort column', { orderBy: 'hourly_rate_minor' }],
      ['an offset', { offset: 100 }],
      ['a profile id', { profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      ['an accepting-work override', { acceptingWork: false }],
      ['a visibility override', { visibility: 'DRAFT' }],
    ])('refuses %s', async (_label, body) => {
      // Eligibility is not negotiable by request body, and a filter that accepts a column name
      // or free text destined for a query is an injection surface (docs/api/pagination.md).
      expect((await post(body)).status).toBe(400);
      expect(search['searchInvestigators']).not.toHaveBeenCalled();
    });
  });

  describe('malformed filters', () => {
    it.each([
      ['a country that is not an ISO code', { countryCode: 'Armenia' }],
      ['a lower-case country', { countryCode: 'am' }],
      ['a language that is not an ISO code', { languages: ['Armenian'] }],
      ['too many languages', { languages: Array.from({ length: 21 }, () => 'en') }],
      [
        'too many taxonomy nodes',
        {
          taxonomyNodeIds: Array.from({ length: 21 }, () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        },
      ],
      ['a taxonomy node that is not a uuid', { taxonomyNodeIds: ['corporate/due-diligence'] }],
      ['a longitude out of range', { near: { lon: 181, lat: 40 } }],
      ['a latitude out of range', { near: { lon: 44, lat: 91 } }],
      ['a radius beyond the maximum', { near: { lon: 44, lat: 40 }, radiusKm: 101 }],
      ['a negative radius', { near: { lon: 44, lat: 40 }, radiusKm: -1 }],
      ['a fractional radius', { near: { lon: 44, lat: 40 }, radiusKm: 10.5 }],
      [
        'a day of week out of range',
        { availableDuring: { dayOfWeek: 7, startMinute: 0, endMinute: 60 } },
      ],
      [
        'a minute out of range',
        { availableDuring: { dayOfWeek: 1, startMinute: 0, endMinute: 1441 } },
      ],
      ['an unknown pricing model', { pricingModel: 'BARTER' }],
      ['a fractional limit', { limit: 2.5 }],
      ['a cursor that is absurdly long', { cursor: 'x'.repeat(513) }],
    ])('refuses %s', async (_label, body) => {
      expect((await post(body)).status).toBe(400);
      expect(search['searchInvestigators']).not.toHaveBeenCalled();
    });
  });
});
