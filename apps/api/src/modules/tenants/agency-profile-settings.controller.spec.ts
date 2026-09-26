import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { AgencyProfileController } from './profile/agency-profile.controller';
import { AgencyProfileService } from './profile/agency-profile.service';
import { AgencySettingsController } from './settings/agency-settings.controller';
import { AgencySettingsService } from './settings/agency-settings.service';
import { validationPipe } from '../../common/validation/pipe';

/**
 * The profile and settings routes (T-084): which agency they act on is the request's workspace,
 * never the path or the body; the public profile is by id; and a response that may carry a signed
 * image link is never cached.
 */
const actor = testActor({ userId: '00000000-0000-4000-8000-0000000000d1' });
const AGENCY = '00000000-0000-4000-8000-0000000000d2';

describe('agency profile and settings routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async () => {
    const profiles = {
      readOwn: vi.fn().mockResolvedValue({ name: 'Own' }),
      update: vi.fn().mockResolvedValue({ name: 'Updated' }),
      publish: vi.fn().mockResolvedValue({ name: 'Published' }),
      unpublish: vi.fn().mockResolvedValue({ name: 'Draft' }),
      readPublished: vi.fn().mockResolvedValue({ id: AGENCY }),
    };
    const settings = {
      read: vi.fn().mockResolvedValue({ branding: { version: 0 } }),
      update: vi.fn().mockResolvedValue({ version: 1 }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AgencyProfileController, AgencySettingsController],
      providers: [
        { provide: AgencyProfileService, useValue: profiles },
        { provide: AgencySettingsService, useValue: settings },
        { provide: ActorService, useValue: { fromRefreshToken: async () => actor } },
        workspaceResolverStub(actor),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    app = instance;
    return { http: request(instance.getHttpServer()), profiles, settings };
  };

  describe('the profile', () => {
    it('reads the agency the request acts in — "current" is never taken for an id', async () => {
      const { http, profiles } = await make();
      const res = await http.get('/api/v1/agencies/current/profile');
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(profiles.readOwn).toHaveBeenCalledWith(actor, expect.anything());
      expect(profiles.readPublished).not.toHaveBeenCalled();
    });

    it('changes it with the version read, and nothing the server owns', async () => {
      const { http, profiles } = await make();
      const ok = await http
        .patch('/api/v1/agencies/current/profile')
        .send({ version: 2, headline: 'Due diligence', logoMediaId: null });
      expect(ok.status).toBe(200);
      expect(ok.headers['cache-control']).toBe('no-store');
      expect(profiles.update).toHaveBeenCalledWith(
        actor,
        expect.objectContaining({ version: 2, headline: 'Due diligence', logoMediaId: null }),
        expect.anything(),
      );

      for (const body of [
        { headline: 'No version' },
        { version: -1 },
        { version: 1, publishedAt: '2026-01-01' },
        { version: 1, tenantId: AGENCY },
        { version: 1, logoMediaId: 'not-a-uuid' },
        { version: 1, about: 'x'.repeat(4001) },
      ]) {
        const res = await http.patch('/api/v1/agencies/current/profile').send(body);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect(profiles.update).toHaveBeenCalledTimes(1);
    });

    it('publishes and unpublishes with the version read, answering 200', async () => {
      const { http, profiles } = await make();
      const out = await http.post('/api/v1/agencies/current/profile/publish').send({ version: 3 });
      expect(out.status).toBe(200);
      expect(out.headers['cache-control']).toBe('no-store');
      expect(profiles.publish).toHaveBeenCalledWith(actor, 3, expect.anything());
      const back = await http
        .post('/api/v1/agencies/current/profile/unpublish')
        .send({ version: 4 });
      expect(back.status).toBe(200);
      expect(profiles.unpublish).toHaveBeenCalledWith(actor, 4, expect.anything());
      expect((await http.post('/api/v1/agencies/current/profile/publish').send({})).status).toBe(
        400,
      );
    });

    it('reads a published agency by id, uncached, and refuses anything that is not one', async () => {
      const { http, profiles } = await make();
      const res = await http.get(`/api/v1/agencies/${AGENCY}/profile`);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(profiles.readPublished).toHaveBeenCalledWith(actor, AGENCY, expect.anything());
      expect((await http.get('/api/v1/agencies/not-an-id/profile')).status).toBe(400);
    });
  });

  describe('settings', () => {
    it('reads every section of the agency the request acts in', async () => {
      const { http, settings } = await make();
      const res = await http.get('/api/v1/agencies/current/settings');
      expect(res.status).toBe(200);
      expect(settings.read).toHaveBeenCalledWith(actor, expect.anything());
    });

    it('changes one section by name', async () => {
      const { http, settings } = await make();
      const res = await http
        .patch('/api/v1/agencies/current/settings/branding')
        .send({ version: 0, values: { accentColor: '#1d4ed8' } });
      expect(res.status).toBe(200);
      expect(settings.update).toHaveBeenCalledWith(
        actor,
        'branding',
        { version: 0, values: { accentColor: '#1d4ed8' } },
        expect.anything(),
      );
    });

    it('answers 404 for a section that does not exist, and 400 for a body without values', async () => {
      const { http, settings } = await make();
      expect(
        (
          await http
            .patch('/api/v1/agencies/current/settings/theme')
            .send({ version: 0, values: {} })
        ).status,
      ).toBe(404);
      expect(
        (await http.patch('/api/v1/agencies/current/settings/branding').send({ version: 0 }))
          .status,
      ).toBe(400);
      expect(settings.update).not.toHaveBeenCalled();
    });
  });
});
