import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsService } from './assignments.service';
import { PolicyRefusalService } from './policy-refusal.service';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';

const ACTOR = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('assignments controller', () => {
  let app: INestApplication;
  let assignments: Record<string, ReturnType<typeof vi.fn>>;
  let refusal: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    assignments = {
      getForParty: vi.fn().mockResolvedValue({ id: ID }),
      accept: vi.fn().mockResolvedValue({ id: ID, status: 'ACCEPTED' }),
      createForAuthorizedPayment: vi.fn(),
    };
    refusal = {
      decline: vi.fn().mockResolvedValue({ id: ID, status: 'CANCELLED' }),
      halt: vi.fn().mockResolvedValue({ id: ID, status: 'SUSPENDED' }),
    };
    const mod = await Test.createTestingModule({
      controllers: [AssignmentsController],
      providers: [
        { provide: AssignmentsService, useValue: assignments },
        { provide: PolicyRefusalService, useValue: refusal },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
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

    const ground = 'The attachment appears to be an intercepted private message';
    expect(
      (
        await http()
          .post(`/assignments/${ID}/decline`)
          .send({ reasonCode: 'POLICY_CONCERN', reason: ground })
      ).status,
    ).toBe(201);
    expect(refusal['decline']).toHaveBeenCalledWith(
      ACTOR,
      ID,
      { reasonCode: 'POLICY_CONCERN', reason: ground },
      expect.any(Object),
    );
  });

  it('declines without a reason', async () => {
    expect((await http().post(`/assignments/${ID}/decline`).send({})).status).toBe(201);
    expect(refusal['decline']).toHaveBeenCalledWith(
      ACTOR,
      ID,
      { reasonCode: undefined, reason: undefined },
      expect.any(Object),
    );
  });

  it('halts with a ground, and refuses one too short to review', async () => {
    const ground = 'Customer asked me to access the subject’s email account';
    expect((await http().post(`/assignments/${ID}/halt`).send({ ground })).status).toBe(201);
    expect(refusal['halt']).toHaveBeenCalledWith(ACTOR, ID, ground, expect.any(Object));
    expect((await http().post(`/assignments/${ID}/halt`).send({ ground: 'no' })).status).toBe(400);
    expect((await http().post(`/assignments/${ID}/halt`).send({})).status).toBe(400);
    expect(refusal['halt']).toHaveBeenCalledTimes(1);
  });

  it('refuses a decline reason code that does not exist', async () => {
    const res = await http().post(`/assignments/${ID}/decline`).send({ reasonCode: 'BORED' });
    expect(res.status).toBe(400);
    expect(refusal['decline']).not.toHaveBeenCalled();
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
      expect(refusal['decline']).not.toHaveBeenCalled();
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
