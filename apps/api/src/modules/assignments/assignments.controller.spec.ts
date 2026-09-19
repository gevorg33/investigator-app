import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { closeApp, listenOnce } from '../../../test/http';

const ACTOR = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('assignments controller', () => {
  let app: INestApplication;
  let assignments: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    assignments = {
      getForParty: vi.fn().mockResolvedValue({ id: ID }),
      accept: vi.fn().mockResolvedValue({ id: ID, status: 'ACCEPTED' }),
      decline: vi.fn().mockResolvedValue({ id: ID, status: 'CANCELLED' }),
      createForAuthorizedPayment: vi.fn(),
    };
    const mod = await Test.createTestingModule({
      controllers: [AssignmentsController],
      providers: [
        { provide: AssignmentsService, useValue: assignments },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    // As bootstrap.ts does, so a domain error from a handler arrives as its own status rather
    // than as a 500.
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());

  it('reads one assignment', async () => {
    expect((await http().get(`/assignments/${ID}`)).status).toBe(200);
    expect(assignments['getForParty']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  it('accepts and declines', async () => {
    expect((await http().post(`/assignments/${ID}/accept`).send({})).status).toBe(201);
    expect(assignments['accept']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));

    expect(
      (await http().post(`/assignments/${ID}/decline`).send({ reason: 'POLICY_CONCERN' })).status,
    ).toBe(201);
    expect(assignments['decline']).toHaveBeenCalledWith(
      ACTOR,
      ID,
      'POLICY_CONCERN',
      expect.any(Object),
    );
  });

  it('declines without a reason', async () => {
    expect((await http().post(`/assignments/${ID}/decline`).send({})).status).toBe(201);
    expect(assignments['decline']).toHaveBeenCalledWith(ACTOR, ID, undefined, expect.any(Object));
  });

  describe('there is no way to create one over HTTP', () => {
    it.each([
      ['POST /assignments', () => http().post('/assignments').send({ quoteId: ID })],
      ['POST /assignments/:id', () => http().post(`/assignments/${ID}`).send({})],
      ['PUT /assignments/:id', () => http().put(`/assignments/${ID}`).send({ status: 'ACCEPTED' })],
    ])('%s is not a route', async (_label, call) => {
      // An assignment exists because a verified webhook established that money was authorized.
      // Neither party gets to declare that, so creation is a system operation with no endpoint.
      expect((await call()).status).toBe(404);
      expect(assignments['createForAuthorizedPayment']).not.toHaveBeenCalled();
    });
  });

  describe('the request body is closed', () => {
    it.each([
      ['a status', { status: 'COMPLETED' }],
      ['a payment reference', { paymentReference: 'pi_123' }],
      ['a price', { priceMinor: 1 }],
      ['an acceptance deadline', { acceptanceDueAt: '2030-01-01T00:00:00.000Z' }],
      ['a reason over 1000 characters', { reason: 'x'.repeat(1001) }],
    ])('refuses %s on decline', async (_label, body) => {
      expect((await http().post(`/assignments/${ID}/decline`).send(body)).status).toBe(400);
      expect(assignments['decline']).not.toHaveBeenCalled();
    });

    it('refuses anything in the acceptance body', async () => {
      expect((await http().post(`/assignments/${ID}/accept`).send({ priceMinor: 1 })).status).toBe(
        400,
      );
      expect(assignments['accept']).not.toHaveBeenCalled();
    });
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await http().get('/assignments/not-a-uuid')).status).toBe(400);
  });
});
