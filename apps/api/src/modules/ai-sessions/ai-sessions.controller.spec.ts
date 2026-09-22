import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { AiSessionsController } from './ai-sessions.controller';
import { AiSessionsService } from './ai-sessions.service';

const ID = '00000000-0000-4000-8000-0000000000e5';
const me = testActor({ userId: '00000000-0000-4000-8000-0000000000f5' });

/** What the routes accept before the service is reached (T-045). Whose it is, is the service's. */
describe('assistant session routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (sessions: Partial<AiSessionsService>, who: typeof me | null = me) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AiSessionsController],
      providers: [
        { provide: AiSessionsService, useValue: sessions },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (who === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return who;
            },
          },
        },
        workspaceResolverStub(who ?? me),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('refuses anyone not signed in', async () => {
    const list = vi.fn();
    app = await make({ list }, null);
    expect((await request(app.getHttpServer()).get('/api/v1/ai/sessions')).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('routes every operation to the service, with the caller', async () => {
    const view = { id: ID };
    const s = {
      create: vi.fn().mockResolvedValue(view),
      list: vi
        .fn()
        .mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }),
      search: vi.fn().mockResolvedValue([]),
      open: vi.fn().mockResolvedValue(view),
      resume: vi.fn().mockResolvedValue(view),
      messages: vi
        .fn()
        .mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } }),
      rename: vi.fn().mockResolvedValue(view),
      archive: vi.fn().mockResolvedValue(view),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    app = await make(s);
    const http = request(app.getHttpServer());
    const base = '/api/v1/ai/sessions';

    expect((await http.post(base).send({ title: 'Planning' })).status).toBe(201);
    expect((await http.get(`${base}?archived=true&limit=10`)).status).toBe(200);
    expect((await http.get(`${base}/search?q=screening`)).status).toBe(200);
    expect((await http.get(`${base}/${ID}`)).status).toBe(200);
    expect((await http.post(`${base}/${ID}/resume`)).status).toBe(200);
    expect((await http.get(`${base}/${ID}/messages?limit=5`)).status).toBe(200);
    expect((await http.patch(`${base}/${ID}`).send({ title: 'Renamed' })).status).toBe(200);
    expect((await http.post(`${base}/${ID}/archive`)).status).toBe(200);
    expect((await http.delete(`${base}/${ID}`)).status).toBe(204);

    expect(s.create.mock.calls[0]?.slice(0, 2)).toEqual([me, { title: 'Planning' }]);
    expect(s.list.mock.calls[0]?.[1]).toEqual({ archived: true, limit: 10, cursor: undefined });
    expect(s.search.mock.calls[0]?.[1]).toBe('screening');
    expect(s.messages.mock.calls[0]?.slice(1, 3)).toEqual([ID, { limit: 5, cursor: undefined }]);
    expect(s.rename.mock.calls[0]?.slice(1, 3)).toEqual([ID, 'Renamed']);
    // "search" is its own route, never read as a session id.
    expect(s.open).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a title too long to be one', 'post', '', { title: 'x'.repeat(121) }],
    ['an empty title on rename', 'patch', `/${ID}`, { title: '' }],
    ['a field the server owns', 'post', '', { title: 'x', userId: ID }],
    ['a message smuggled into create', 'post', '', { title: 'x', messages: [] }],
  ] as const)('refuses %s', async (_what, method, path, body) => {
    const create = vi.fn();
    const rename = vi.fn();
    app = await make({ create, rename });
    const res = await request(app.getHttpServer())[method](`/api/v1/ai/sessions${path}`).send(body);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('refuses a search too short to mean anything, and an id that is not one', async () => {
    const search = vi.fn();
    const open = vi.fn();
    app = await make({ search, open });
    const http = request(app.getHttpServer());
    expect((await http.get('/api/v1/ai/sessions/search?q=a')).status).toBe(400);
    expect((await http.get('/api/v1/ai/sessions/latest')).status).toBe(400);
    expect((await http.get('/api/v1/ai/sessions?archived=maybe')).status).toBe(400);
    expect(search).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
