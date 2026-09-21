import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorService } from '../../common/authz/actor.service';
import { testActor } from '../../../test/actor';
import { ServiceAreasController } from './service-areas.controller';
import { ServiceAreasService } from './service-areas.service';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';

const ACTOR = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('service areas controller', () => {
  let app: INestApplication;
  let areas: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    areas = {
      listMine: vi.fn().mockResolvedValue([]),
      createMine: vi.fn().mockResolvedValue({ id: ID }),
      deleteMine: vi.fn().mockResolvedValue(undefined),
    };
    const mod = await Test.createTestingModule({
      controllers: [ServiceAreasController],
      providers: [
        { provide: ServiceAreasService, useValue: areas },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());
  const radius = { kind: 'RADIUS', label: 'Yerevan', centre: { lon: 44.52, lat: 40.19 }, radiusKm: 10 };
  const polygon = {
    kind: 'POLYGON',
    label: 'District',
    boundary: [
      { lon: 44, lat: 40 },
      { lon: 45, lat: 40 },
      { lon: 45, lat: 41 },
    ],
  };

  it('lists the caller’s own areas', async () => {
    expect((await http().get('/service-areas/me')).status).toBe(200);
    expect(areas['listMine']).toHaveBeenCalledWith(ACTOR, expect.any(Object));
  });

  it.each([
    ['a radius area', radius],
    ['a drawn area', polygon],
  ])('creates %s', async (_label, body) => {
    expect((await http().post('/service-areas/me').send(body)).status).toBe(201);
    expect(areas['createMine']).toHaveBeenCalledWith(ACTOR, body, expect.any(Object));
  });

  it.each([
    ['an unknown kind', { ...radius, kind: 'CIRCLE' }],
    ['a radius area with no centre', { kind: 'RADIUS', label: 'x', radiusKm: 10 }],
    ['a radius below 5 km', { ...radius, radiusKm: 4 }],
    ['a radius over 300 km', { ...radius, radiusKm: 301 }],
    ['a fractional radius', { ...radius, radiusKm: 5.5 }],
    ['a longitude out of range', { ...radius, centre: { lon: 181, lat: 40 } }],
    ['a latitude out of range', { ...radius, centre: { lon: 44, lat: -91 } }],
    ['a drawn area with two points', { ...polygon, boundary: polygon.boundary.slice(0, 2) }],
    [
      'a drawn area with 201 points',
      { ...polygon, boundary: Array.from({ length: 201 }, (_, i) => ({ lon: i / 1000, lat: 0 })) },
    ],
    ['an empty label', { ...radius, label: '' }],
    ['a label over 80 characters', { ...radius, label: 'x'.repeat(81) }],
    ['a client-chosen profile', { ...radius, profileId: ID }],
  ])('rejects %s before reaching the service', async (_label, body) => {
    expect((await http().post('/service-areas/me').send(body)).status).toBe(400);
    expect(areas['createMine']).not.toHaveBeenCalled();
  });

  it('removes by id, and only through the caller’s own collection', async () => {
    expect((await http().delete(`/service-areas/me/${ID}`)).status).toBe(204);
    expect(areas['deleteMine']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
    expect((await http().delete('/service-areas/me/not-a-uuid')).status).toBe(400);
  });

  it('offers no route to read another investigator’s areas', async () => {
    expect((await http().get(`/service-areas/${ID}`)).status).toBe(404);
  });
});
