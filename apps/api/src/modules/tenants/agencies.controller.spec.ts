import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { AgenciesController } from './agencies.controller';
import { AgenciesService, type AgencyView } from './agencies.service';

/**
 * What the endpoint accepts and what it refuses to hear (T-083). The workspace the request acts
 * in is the guard's business; what matters here is that the body cannot decide anything the
 * server owns.
 */
const actor = testActor({ userId: '00000000-0000-4000-8000-0000000000c1' });

const created: AgencyView = {
  id: '00000000-0000-4000-8000-0000000000c2',
  name: 'Northlight',
  status: 'ACTIVE',
  countryCode: 'AM',
  businessEmail: 'hello@northlight.test',
  timezone: 'Asia/Yerevan',
  currency: 'AMD',
  missing: [],
};

const body = {
  name: 'Northlight',
  countryCode: 'AM',
  businessEmail: 'hello@northlight.test',
  timezone: 'Asia/Yerevan',
  currency: 'AMD',
  agreementDocumentId: '00000000-0000-4000-8000-0000000000c3',
};

describe('POST /api/v1/agencies', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (create = vi.fn().mockResolvedValue(created)) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgenciesController],
      providers: [
        { provide: AgenciesService, useValue: { create } },
        // The guard resolves the actor from the session and the workspace from the header; both
        // are stood in for here, because what this spec is about is the body.
        { provide: ActorService, useValue: { fromRefreshToken: async () => actor } },
        workspaceResolverStub(actor),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    // Exactly what bootstrap.ts installs: a body naming anything the server owns is refused,
    // not quietly stripped.
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return { app: instance, create };
  };

  it('creates the agency and answers with what it made', async () => {
    const made = await make();
    app = made.app;

    const res = await request(app.getHttpServer())
      .post('/api/v1/agencies')
      .set('Idempotency-Key', 'a-key-for-this-attempt')
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
    expect(made.create).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ name: 'Northlight' }),
      'a-key-for-this-attempt',
      expect.anything(),
    );
  });

  it('refuses without an Idempotency-Key, so a retry cannot make a second agency', async () => {
    const made = await make();
    app = made.app;

    const res = await request(app.getHttpServer()).post('/api/v1/agencies').send(body);

    expect(res.status).toBe(422);
    expect(made.create).not.toHaveBeenCalled();
  });

  it.each([
    ['status', 'ACTIVE'],
    ['kind', 'PERSONAL'],
    ['verificationStatus', 'VERIFIED'],
  ])('refuses a body that tries to set %s', async (field, value) => {
    // These belong to the server. The DTO has no field for them, and the pipe refuses a body
    // that names one rather than stripping it — so a hostile client is told no, not ignored.
    const made = await make();
    app = made.app;

    const res = await request(app.getHttpServer())
      .post('/api/v1/agencies')
      .set('Idempotency-Key', 'another-key')
      .send({ ...body, [field]: value });

    expect(res.status).toBe(400);
    expect(made.create).not.toHaveBeenCalled();
  });

  it.each([
    ['no name', { ...body, name: undefined }],
    ['a country that is not a code', { ...body, countryCode: 'Armenia' }],
    ['a currency that is not a code', { ...body, currency: 'dram' }],
    ['an address that is not an email', { ...body, businessEmail: 'not-an-email' }],
    ['no agreement', { ...body, agreementDocumentId: undefined }],
  ])('refuses %s', async (_label, payload) => {
    const made = await make();
    app = made.app;

    const res = await request(app.getHttpServer())
      .post('/api/v1/agencies')
      .set('Idempotency-Key', 'key-for-invalid')
      .send(payload);

    expect(res.status).toBe(400);
    expect(made.create).not.toHaveBeenCalled();
  });
});

describe('GET and PATCH /api/v1/agencies/current (T-150)', () => {
  let app: INestApplication | undefined;
  const details = { ...created, version: 2, mayChange: true };

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async () => {
    const readCurrent = vi.fn().mockResolvedValue(details);
    const updateCurrent = vi.fn().mockResolvedValue(details);
    const moduleRef = await Test.createTestingModule({
      controllers: [AgenciesController],
      providers: [
        { provide: AgenciesService, useValue: { readCurrent, updateCurrent } },
        { provide: ActorService, useValue: { fromRefreshToken: async () => actor } },
        workspaceResolverStub(actor),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    app = instance;
    return { http: request(instance.getHttpServer()), readCurrent, updateCurrent };
  };

  it('reads the agency the request acts in, uncached', async () => {
    const { http, readCurrent } = await make();
    const res = await http.get('/api/v1/agencies/current');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(details);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(readCurrent).toHaveBeenCalledWith(actor, expect.anything());
  });

  it('passes a change on with the version read', async () => {
    const { http, updateCurrent } = await make();
    const res = await http
      .patch('/api/v1/agencies/current')
      .send({ version: 2, currency: 'USD', timezone: 'Europe/Moscow' });
    expect(res.status).toBe(200);
    expect(updateCurrent).toHaveBeenCalledWith(
      actor,
      { version: 2, currency: 'USD', timezone: 'Europe/Moscow' },
      expect.anything(),
    );
  });

  it.each([
    ['no version', { currency: 'USD' }],
    ['a status', { version: 2, status: 'ACTIVE' }],
    ['a time zone that is an offset', { version: 2, timezone: '+04:00' }],
    ['a time zone that does not exist', { version: 2, timezone: 'Mars/Olympus' }],
    ['an address that is not an email', { version: 2, businessEmail: 'desk' }],
    ['a cleared currency', { version: 2, currency: null }],
    ['a name too short', { version: 2, name: 'N' }],
  ])('refuses %s', async (_label, payload) => {
    const { http, updateCurrent } = await make();
    const res = await http.patch('/api/v1/agencies/current').send(payload);
    expect(res.status).toBe(400);
    expect(updateCurrent).not.toHaveBeenCalled();
  });
});
