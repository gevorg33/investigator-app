import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { AssistantTurnController, sseFrame } from './assistant-turn.controller';
import { AssistantTurnService, type Turn, type TurnEvent } from './assistant-turn.service';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const ID = '00000000-0000-4000-8000-000000000056';
const USER_MESSAGE = {
  type: 'message',
  message: { id: 'm1', role: 'USER' },
} as unknown as TurnEvent;
const TURN = {
  sessionId: ID,
  question: 'q',
  admitted: {},
  opening: [USER_MESSAGE],
} as unknown as Turn;
const REPLY = { type: 'message', message: { id: 'm2', role: 'ASSISTANT' } } as unknown as TurnEvent;

describe('assistant turn controller (T-056)', () => {
  let app: INestApplication;
  let turns: {
    ask: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
    run: ReturnType<typeof vi.fn>;
  };

  const build = async (actor: typeof ACTOR | null) => {
    turns = {
      ask: vi.fn().mockResolvedValue(TURN),
      retry: vi.fn().mockResolvedValue({ ...TURN, opening: [] }),
      run: vi.fn(async (_a, _t, _r, emit: (e: TurnEvent) => void) => {
        emit({ type: 'step', step: { step: 'searching' } });
        emit(REPLY);
      }),
    };
    const mod = await Test.createTestingModule({
      controllers: [AssistantTurnController],
      providers: [
        { provide: AssistantTurnService, useValue: turns },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (actor === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return actor;
            },
          },
        },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  };

  beforeEach(() => build(ACTOR));
  afterEach(async () => {
    await closeApp(app);
  });

  const ask = (body: object, id = ID) =>
    request(app.getHttpServer()).post(`/ai/sessions/${id}/turns`).send(body);

  it('frames an event as its type and its data', () => {
    expect(sseFrame({ type: 'step', step: { step: 'writing', sources: 2 } })).toBe(
      'event: step\ndata: {"step":{"step":"writing","sources":2}}\n\n',
    );
    expect(sseFrame({ type: 'done' })).toBe('event: done\ndata: {}\n\n');
  });

  it('streams the stored question, each step, the reply and the end — unbuffered, uncached', async () => {
    const res = await ask({ content: 'How long does a quote last?', locale: 'ru' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(res.headers['x-accel-buffering']).toBe('no');
    expect(res.text).toBe(
      [USER_MESSAGE, { type: 'step', step: { step: 'searching' } }, REPLY, { type: 'done' }]
        .map((e) => sseFrame(e as TurnEvent))
        .join(''),
    );
    expect(turns.ask).toHaveBeenCalledWith(
      ACTOR,
      ID,
      { content: 'How long does a quote last?', locale: 'ru' },
      expect.any(Object),
    );
    expect(turns.run).toHaveBeenCalledWith(
      ACTOR,
      TURN,
      expect.any(Object),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('passes an answer to discovery’s question on as it came (T-059)', async () => {
    const body = {
      content: 'Use my location',
      clarifies: true,
      near: { lon: 44.52, lat: 40.19 },
      radiusKm: 25,
      taxonomyNodeIds: ['00000000-0000-4000-8000-000000000059'],
    };
    expect((await ask(body)).status).toBe(200);
    expect(turns.ask.mock.calls[0]?.[2]).toMatchObject(body);
  });

  it('retries the unanswered question, streaming only the answer', async () => {
    const res = await request(app.getHttpServer())
      .post(`/ai/sessions/${ID}/turns/retry`)
      .send({ locale: 'hy' });
    expect(res.status).toBe(200);
    expect(res.text).toBe(
      [{ type: 'step', step: { step: 'searching' } }, REPLY, { type: 'done' }]
        .map((e) => sseFrame(e as TurnEvent))
        .join(''),
    );
    expect(turns.retry).toHaveBeenCalledWith(ACTOR, ID, { locale: 'hy' }, expect.any(Object));
  });

  it('refuses in the usual shape, with its status, when a turn is refused before it starts', async () => {
    turns.ask.mockRejectedValueOnce(new AppError(ErrorCode.SERVICE_UNAVAILABLE));
    const res = await ask({ content: 'How long?' });
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      messageKey: 'error.common.service_unavailable',
    });
    expect(turns.run).not.toHaveBeenCalled();
  });

  it.each([
    ['no content', {}],
    ['content too short to be a question', { content: 'hi' }],
    ['content that is only whitespace', { content: '   \n\t ' }],
    ['content longer than 2000 characters', { content: 'x'.repeat(2001) }],
    ['a language the knowledge base does not have', { content: 'How long?', locale: 'de' }],
    // The caller does not choose a role, an audience or a workspace for their question.
    ['a role', { content: 'How long?', role: 'ASSISTANT' }],
    ['an audience', { content: 'How long?', audience: 'staff' }],
    ['a workspace', { content: 'How long?', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    // Answering discovery's question (T-059): each part typed and bounded.
    ['a clarification flag that is not a boolean', { content: 'Corporate', clarifies: 'yes' }],
    ['a specialty that is not an id', { content: 'Corporate', clarifies: true, taxonomyNodeIds: ['x'] }],
    ['a point off the globe', { content: 'Here', clarifies: true, near: { lon: 0, lat: 95 } }],
    ['a point with extras', { content: 'Here', clarifies: true, near: { lon: 0, lat: 0, alt: 3 } }],
    ['a radius past the limit', { content: 'Here', clarifies: true, near: { lon: 0, lat: 0 }, radiusKm: 100000 }],
  ])('refuses %s', async (_label, body) => {
    expect((await ask(body)).status).toBe(400);
    expect(turns.ask).not.toHaveBeenCalled();
  });

  it('refuses an id that is not a session id', async () => {
    expect((await ask({ content: 'How long?' }, 'not-a-uuid')).status).toBe(400);
  });

  it('refuses a caller who is not signed in', async () => {
    await closeApp(app);
    await build(null);
    expect((await ask({ content: 'How long?' })).status).toBe(401);
    expect(turns.ask).not.toHaveBeenCalled();
  });

  it('stops the turn when the client goes away, and writes nothing after', async () => {
    let seen: AbortSignal | undefined;
    let finished!: () => void;
    const over = new Promise<void>((resolve) => (finished = resolve));
    turns.run.mockImplementationOnce(
      async (_a, _t, _r, emit: (e: TurnEvent) => void, signal: AbortSignal) => {
        seen = signal;
        emit({ type: 'step', step: { step: 'searching' } });
        await new Promise((resolve) => signal.addEventListener('abort', resolve));
        emit(REPLY);
        finished();
      },
    );

    const { port } = app.getHttpServer().address() as AddressInfo;
    const body = JSON.stringify({ content: 'How long does a quote last?' });
    const received = await new Promise<string>((resolve, reject) => {
      const client = httpRequest(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: `/ai/sessions/${ID}/turns`,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res: IncomingMessage) => {
          let text = '';
          res.on('data', (chunk: Buffer) => {
            text += chunk.toString();
            // Stop, as a person would, once the answer has started to form.
            if (text.includes('event: step')) {
              res.destroy();
              resolve(text);
            }
          });
        },
      );
      client.on('error', (e) => (e.message === 'aborted' ? undefined : reject(e)));
      client.end(body);
    });
    await over;

    expect(seen?.aborted).toBe(true);
    expect(received).not.toContain('"m2"');
    expect(received).not.toContain('event: done');
  });
});
