import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { closeApp, listenOnce } from '../../../test/http';
import { workspaceResolverStub } from '../../../test/context';
import { validationPipe } from '../../common/validation/pipe';

const ACTOR = testActor({ userId: 'u1', roles: ['INVESTIGATOR'] });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
// Deliberately low-entropy and obviously fake. A ULID-shaped literal here read as a credential
// to the secret scanner — correctly, on the evidence available to it — and the fix is a test
// value that cannot be mistaken for one, not an allowlist that teaches the scanner to ignore
// this file.
const IDEM_HEADER = 'test-quote-accept-1';

describe('quotes controller', () => {
  let app: INestApplication;
  let quotes: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    quotes = {
      submit: vi.fn().mockResolvedValue({ id: ID }),
      withdraw: vi.fn().mockResolvedValue({ id: ID }),
      listMine: vi.fn().mockResolvedValue([]),
      listForMission: vi.fn().mockResolvedValue([]),
      accept: vi.fn().mockResolvedValue({ id: ID, status: 'ACCEPTED' }),
    };
    const mod = await Test.createTestingModule({
      controllers: [QuotesController],
      providers: [
        { provide: QuotesService, useValue: quotes },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(validationPipe());
    // The filter bootstrap.ts installs. This controller is the first to throw an AppError from
    // the handler body rather than from a pipe — a missing Idempotency-Key — and without the
    // filter that 422 arrived as a bare 500, which is what this spec caught.
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());
  const offer = {
    priceMinor: 250_000,
    currency: 'AMD',
    estimatedDurationDays: 14,
    scope: 'Records research at the declared address.',
    deliverables: 'A written report with sources listed.',
    cancellationTerms: 'Full refund before work starts.',
    expiresAt: '2026-12-01T00:00:00.000Z',
  };

  it('submits a quote for a mission', async () => {
    expect((await http().post(`/missions/${ID}/quotes`).send(offer)).status).toBe(201);
    expect(quotes['submit']).toHaveBeenCalledWith(ACTOR, ID, offer, expect.any(Object));
  });

  it('lists the caller’s own quotes and a mission’s quotes', async () => {
    expect((await http().get('/quotes/me')).status).toBe(200);
    expect((await http().get(`/missions/${ID}/quotes`)).status).toBe(200);
    expect(quotes['listForMission']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  it('withdraws by id', async () => {
    expect((await http().post(`/quotes/${ID}/withdraw`).send({})).status).toBe(201);
    expect(quotes['withdraw']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  describe('accepting', () => {
    it('requires an Idempotency-Key header', async () => {
      const res = await http()
        .post(`/quotes/${ID}/accept`)
        .set('Idempotency-Key', IDEM_HEADER)
        .send({});
      expect(res.status).toBe(201);
      expect(quotes['accept']).toHaveBeenCalledWith(ACTOR, ID, IDEM_HEADER, expect.any(Object));
    });

    it.each([
      ['no header at all', undefined],
      ['an empty header', ''],
      ['a header with a space', 'not a key'],
    ])('refuses acceptance with %s', async (_label, key) => {
      // Generating a key server-side would make every retry a new operation — the exact bug
      // the header exists to prevent — so a missing one fails the request.
      const req = http().post(`/quotes/${ID}/accept`);
      if (key !== undefined) req.set('Idempotency-Key', key);
      expect((await req.send({})).status).toBe(422);
      expect(quotes['accept']).not.toHaveBeenCalled();
    });
  });

  describe('the request body is closed', () => {
    it.each([
      ['a status', { ...offer, status: 'ACCEPTED' }],
      ['a chosen investigator', { ...offer, investigatorProfileId: ID }],
      ['a platform fee', { ...offer, feeMinor: 0 }],
      ['a negative price', { ...offer, priceMinor: -1 }],
      ['a fractional price', { ...offer, priceMinor: 1.5 }],
      ['a lower-case currency', { ...offer, currency: 'amd' }],
      ['a zero duration', { ...offer, estimatedDurationDays: 0 }],
      ['an empty scope', { ...offer, scope: '' }],
      ['a scope over 5000 characters', { ...offer, scope: 'x'.repeat(5001) }],
      ['a malformed expiry', { ...offer, expiresAt: 'next Tuesday' }],
      ['no cancellation terms', { ...offer, cancellationTerms: undefined }],
    ])('refuses %s', async (_label, body) => {
      expect((await http().post(`/missions/${ID}/quotes`).send(body)).status).toBe(400);
      expect(quotes['submit']).not.toHaveBeenCalled();
    });

    it('refuses anything in the acceptance body', async () => {
      // The terms are already fixed by the quote; a client cannot smuggle a price into
      // acceptance.
      const res = await http()
        .post(`/quotes/${ID}/accept`)
        .set('Idempotency-Key', IDEM_HEADER)
        .send({ priceMinor: 1 });
      expect(res.status).toBe(400);
      expect(quotes['accept']).not.toHaveBeenCalled();
    });
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await http().post('/quotes/not-a-uuid/withdraw').send({})).status).toBe(400);
  });
});
