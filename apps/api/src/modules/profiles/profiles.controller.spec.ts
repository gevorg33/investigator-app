import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorService } from '../../common/authz/actor.service';
import { testActor } from '../../../test/authz-cases';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';

const ACTOR = testActor({ userId: 'u1', sessionId: 's1', roles: ['CUSTOMER', 'INVESTIGATOR'] });
const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('profiles controller', () => {
  let app: INestApplication;
  let profiles: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    profiles = {
      activateRole: vi.fn().mockResolvedValue({ profileId: UUID }),
      getMyInvestigatorProfile: vi.fn().mockResolvedValue({ id: UUID }),
      updateMyInvestigatorProfile: vi.fn().mockResolvedValue({ id: UUID }),
      getMyCustomerProfile: vi.fn().mockResolvedValue({ id: UUID }),
      updateMyCustomerProfile: vi.fn().mockResolvedValue({ id: UUID }),
      getPublicInvestigatorProfile: vi.fn().mockResolvedValue({ id: UUID }),
      getPublicCustomerProfile: vi.fn().mockResolvedValue({ id: UUID }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [
        { provide: ProfilesService, useValue: profiles },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());

  describe('role activation', () => {
    it('activates a role for the resolved actor', async () => {
      const res = await http().post('/profiles/roles').send({ role: 'INVESTIGATOR' });
      expect(res.status).toBe(201);
      expect(profiles['activateRole']).toHaveBeenCalledWith(
        ACTOR,
        'INVESTIGATOR',
        expect.any(Object),
      );
    });

    it('refuses to self-activate STAFF', async () => {
      // Staff roles are granted by staff. The DTO does not admit the value at all.
      const res = await http().post('/profiles/roles').send({ role: 'STAFF' });
      expect(res.status).toBe(400);
      expect(profiles['activateRole']).not.toHaveBeenCalled();
    });

    it('refuses an unknown role', async () => {
      expect((await http().post('/profiles/roles').send({ role: 'ADMIN' })).status).toBe(400);
    });

    it('never takes a user id from the body', async () => {
      const res = await http()
        .post('/profiles/roles')
        .send({ role: 'CUSTOMER', userId: 'somebody-else' });
      expect(res.status).toBe(400);
    });
  });

  describe('own profile routes', () => {
    it('reads by who the caller is, with no id in the path', async () => {
      expect((await http().get('/profiles/investigator/me')).status).toBe(200);
      expect(profiles['getMyInvestigatorProfile']).toHaveBeenCalledWith(ACTOR, expect.any(Object));
    });

    it('updates by who the caller is', async () => {
      const res = await http().patch('/profiles/investigator/me').send({ headline: 'Due diligence' });
      expect(res.status).toBe(200);
      expect(profiles['updateMyInvestigatorProfile']).toHaveBeenCalledWith(
        ACTOR,
        { headline: 'Due diligence' },
        expect.any(Object),
      );
    });

    it('reads and updates the customer profile the same way', async () => {
      expect((await http().get('/profiles/customer/me')).status).toBe(200);
      const res = await http().patch('/profiles/customer/me').send({ organisationName: 'Acme' });
      expect(res.status).toBe(200);
      expect(profiles['updateMyCustomerProfile']).toHaveBeenCalledWith(
        ACTOR,
        { organisationName: 'Acme' },
        expect.any(Object),
      );
    });

    it('rejects a body trying to set a field that is not the caller’s to set', async () => {
      // visibility is the owner's, but userId is not a field at all — mass assignment.
      const res = await http()
        .patch('/profiles/investigator/me')
        .send({ headline: 'x', userId: 'somebody-else' });
      expect(res.status).toBe(400);
    });
  });

  describe('public routes', () => {
    it('reads another profile by id', async () => {
      expect((await http().get(`/profiles/investigator/${UUID}`)).status).toBe(200);
      expect(profiles['getPublicInvestigatorProfile']).toHaveBeenCalledWith(
        ACTOR,
        UUID,
        expect.any(Object),
      );
    });

    it('reads a customer profile by id', async () => {
      expect((await http().get(`/profiles/customer/${UUID}`)).status).toBe(200);
    });

    it('rejects an id that is not a uuid before reaching the service', async () => {
      expect((await http().get('/profiles/investigator/not-a-uuid')).status).toBe(400);
      expect(profiles['getPublicInvestigatorProfile']).not.toHaveBeenCalled();
    });
  });

  describe('DTO validation', () => {
    const patch = (body: unknown) => http().patch('/profiles/investigator/me').send(body);

    it('accepts a full, valid update', async () => {
      const res = await patch({
        headline: 'Corporate due diligence',
        bio: 'Fifteen years.',
        yearsExperience: 15,
        pricingModel: 'HOURLY',
        hourlyRateMinor: 7500,
        currency: 'AMD',
        acceptingWork: true,
        visibility: 'PUBLISHED',
        languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      });
      expect(res.status).toBe(200);
    });

    for (const [name, body] of [
      ['a fractional rate — money is not a float', { hourlyRateMinor: 75.5 }],
      ['a negative rate', { hourlyRateMinor: -1 }],
      ['a lower-case currency', { currency: 'amd' }],
      ['an unknown pricing model', { pricingModel: 'BARTER' }],
      ['an unknown visibility', { visibility: 'SECRET' }],
      ['81 years of experience', { yearsExperience: 81 }],
      ['an upper-case language code', { languages: [{ languageCode: 'HY', proficiency: 'NATIVE' }] }],
      ['a three-letter language code', { languages: [{ languageCode: 'hye', proficiency: 'NATIVE' }] }],
      ['an unknown proficiency', { languages: [{ languageCode: 'hy', proficiency: 'PERFECT' }] }],
      ['day 7', { availability: [{ dayOfWeek: 7, startMinute: 0, endMinute: 60 }] }],
      ['a minute past midnight', { availability: [{ dayOfWeek: 1, startMinute: 0, endMinute: 1441 }] }],
      ['a headline of 121 characters', { headline: 'x'.repeat(121) }],
    ] as Array<[string, Record<string, unknown>]>) {
      it(`rejects ${name}`, async () => {
        expect((await patch(body)).status).toBe(400);
      });
    }

    it('bounds the arrays, so one request cannot write unbounded rows', async () => {
      const languages = Array.from({ length: 21 }, (_, i) => ({
        languageCode: String.fromCharCode(97 + (i % 26)) + 'a',
        proficiency: 'BASIC',
      }));
      expect((await patch({ languages })).status).toBe(400);
    });

    it('accepts an empty array, which clears the set', async () => {
      expect((await patch({ languages: [] })).status).toBe(200);
    });
  });
});
