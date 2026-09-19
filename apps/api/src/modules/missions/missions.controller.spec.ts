import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { ActorService } from '../../common/authz/actor.service';
import { MissionsController } from './missions.controller';
import { MissionsService } from './missions.service';
import { closeApp, listenOnce } from '../../../test/http';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('missions controller', () => {
  let app: INestApplication;
  let missions: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    missions = {
      listMine: vi.fn().mockResolvedValue([]),
      getMine: vi.fn().mockResolvedValue({ id: ID }),
      createDraft: vi.fn().mockResolvedValue({ id: ID }),
      updateDraft: vi.fn().mockResolvedValue({ id: ID }),
      submit: vi.fn().mockResolvedValue({ id: ID, status: 'UNDER_REVIEW' }),
      cancel: vi.fn().mockResolvedValue({ id: ID, status: 'CANCELLED' }),
    };
    const mod = await Test.createTestingModule({
      controllers: [MissionsController],
      providers: [
        { provide: MissionsService, useValue: missions },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
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
  const draft = {
    taxonomyNodeId: ID,
    title: 'Counterparty due diligence',
    description: 'Ownership and filings from public registers.',
    countryCode: 'AM',
    deadline: '2026-12-01',
    budgetMinMinor: 50_000,
    budgetMaxMinor: 150_000,
    currency: 'AMD',
    languages: ['en', 'hy'],
    purpose: 'Deciding whether to sign.',
    subjectRelationship: 'BUSINESS_RELATIONSHIP',
  };

  it('lists the caller’s own missions', async () => {
    expect((await http().get('/missions/me')).status).toBe(200);
    expect(missions['listMine']).toHaveBeenCalledWith(ACTOR, expect.any(Object));
  });

  it('creates a draft', async () => {
    expect((await http().post('/missions/me').send(draft)).status).toBe(201);
    expect(missions['createDraft']).toHaveBeenCalledWith(ACTOR, draft, expect.any(Object));
  });

  it('saves a draft with nothing in it', async () => {
    // A form that refuses to save until it is complete is a form people abandon.
    expect((await http().post('/missions/me').send({})).status).toBe(201);
  });

  it('reads and edits one by id', async () => {
    expect((await http().get(`/missions/me/${ID}`)).status).toBe(200);
    expect(missions['getMine']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));

    expect(
      (await http().patch(`/missions/me/${ID}`).send({ version: 1, title: 'New' })).status,
    ).toBe(200);
    expect(missions['updateDraft']).toHaveBeenCalledWith(
      ACTOR,
      ID,
      { version: 1, title: 'New' },
      expect.any(Object),
    );
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await http().get('/missions/me/not-a-uuid')).status).toBe(400);
    expect(missions['getMine']).not.toHaveBeenCalled();
  });

  describe('submitting', () => {
    it('requires the lawful-purpose confirmation', async () => {
      expect(
        (
          await http()
            .post(`/missions/me/${ID}/submit`)
            .send({ version: 1, lawfulPurposeConfirmed: true })
        ).status,
      ).toBe(201);
      expect(missions['submit']).toHaveBeenCalledWith(
        ACTOR,
        ID,
        { version: 1, lawfulPurposeConfirmed: true },
        expect.any(Object),
      );
    });

    it.each([
      ['it is missing', { version: 1 }],
      ['it is false', { version: 1, lawfulPurposeConfirmed: false }],
      ['it is a string that looks true', { version: 1, lawfulPurposeConfirmed: 'true' }],
    ])('refuses the submission when the confirmation is absent — %s', async (_label, body) => {
      expect((await http().post(`/missions/me/${ID}/submit`).send(body)).status).toBe(400);
      expect(missions['submit']).not.toHaveBeenCalled();
    });

    it('requires the version the client last read', async () => {
      expect(
        (await http().post(`/missions/me/${ID}/submit`).send({ lawfulPurposeConfirmed: true }))
          .status,
      ).toBe(400);
      expect(missions['submit']).not.toHaveBeenCalled();
    });
  });

  it('cancels, with an optional reason', async () => {
    expect((await http().post(`/missions/me/${ID}/cancel`).send({ version: 2 })).status).toBe(201);
    expect(missions['cancel']).toHaveBeenCalledWith(ACTOR, ID, { version: 2 }, expect.any(Object));
  });

  describe('what the client may not send', () => {
    it.each([
      ['a status', { ...draft, status: 'QUOTED' }],
      ['a chosen customer', { ...draft, customerId: ID }],
      ['a version on creation', { ...draft, version: 5 }],
      ['screening flags', { ...draft, flags: ['none'] }],
      [
        'a lawful-purpose timestamp',
        { ...draft, lawfulPurposeConfirmedAt: '2026-09-14T00:00:00Z' },
      ],
      ['a country that is not an ISO code', { ...draft, countryCode: 'Armenia' }],
      ['a currency that is not an ISO code', { ...draft, currency: 'dram' }],
      ['a language that is not an ISO code', { ...draft, languages: ['English'] }],
      ['more than ten languages', { ...draft, languages: Array.from({ length: 11 }, () => 'en') }],
      ['a title over 120 characters', { ...draft, title: 'x'.repeat(121) }],
      ['a description over 5000 characters', { ...draft, description: 'x'.repeat(5001) }],
      ['a negative budget', { ...draft, budgetMinMinor: -1 }],
      ['a fractional budget', { ...draft, budgetMinMinor: 10.5 }],
      ['a malformed date', { ...draft, deadline: '01/12/2026' }],
      ['a latitude out of range', { ...draft, location: { lon: 44, lat: 91 } }],
      ['an unknown relationship', { ...draft, subjectRelationship: 'NEIGHBOUR' }],
    ])('rejects %s before it reaches the service', async (_label, body) => {
      // A status arriving in a request body is the shape of the bug this refuses: nothing
      // outside the transition service decides a mission's state.
      expect((await http().post('/missions/me').send(body)).status).toBe(400);
      expect(missions['createDraft']).not.toHaveBeenCalled();
    });
  });

  it('offers no route that reads or publishes another customer’s mission', async () => {
    // Discovery (T-054) and the moderation queue (T-051) are different questions elsewhere.
    expect((await http().get(`/missions/${ID}`)).status).toBe(404);
    expect((await http().post(`/missions/me/${ID}/publish`).send({})).status).toBe(404);
  });
});
