import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { validationPipe } from '../../common/validation/pipe';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

const ID = '00000000-0000-4000-8000-0000000000d1';
const INTO = '00000000-0000-4000-8000-0000000000d2';
const curator = testActor({
  userId: '00000000-0000-4000-8000-0000000000d3',
  roles: ['STAFF'],
  staffScopes: ['TAXONOMY'],
});
const REASON = 'Agreed at the vocabulary review, see minutes 4';

/** What the tag routes accept before the service is reached (T-055). Who may write is the service's. */
describe('tag routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (tags: Partial<TagsService>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [
        { provide: TagsService, useValue: tags },
        { provide: ActorService, useValue: { fromRefreshToken: async () => curator } },
        workspaceResolverStub(curator),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('lists in the locale asked for, adds, relabels, retires and merges — with the caller', async () => {
    const s = {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: ID }),
      setLabel: vi.fn().mockResolvedValue({ id: ID }),
      deprecate: vi.fn().mockResolvedValue({ id: ID }),
      merge: vi.fn().mockResolvedValue({ id: ID }),
    };
    app = await make(s);
    const http = request(app.getHttpServer());

    expect((await http.get('/api/v1/tags?locale=hy')).status).toBe(200);
    expect(s.list).toHaveBeenCalledWith('hy');
    expect((await http.get('/api/v1/tags')).status).toBe(200);
    expect(s.list).toHaveBeenLastCalledWith(undefined);

    const created = { slug: 'remote-work', label: 'Remote work', reason: REASON };
    expect((await http.post('/api/v1/tags').send(created)).status).toBe(201);
    expect(s.create.mock.calls[0]?.slice(0, 2)).toEqual([curator, created]);

    const label = { label: 'Удалённо', reason: REASON };
    expect((await http.put(`/api/v1/tags/${ID}/labels/ru`).send(label)).status).toBe(200);
    expect(s.setLabel.mock.calls[0]?.slice(0, 4)).toEqual([curator, ID, 'ru', label]);

    expect((await http.post(`/api/v1/tags/${ID}/deprecate`).send({ reason: REASON })).status).toBe(
      200,
    );
    expect(s.deprecate.mock.calls[0]?.slice(0, 3)).toEqual([curator, ID, { reason: REASON }]);

    const merge = { intoId: INTO, reason: REASON };
    expect((await http.post(`/api/v1/tags/${ID}/merge`).send(merge)).status).toBe(200);
    expect(s.merge.mock.calls[0]?.slice(0, 3)).toEqual([curator, ID, merge]);
  });

  it.each([
    [
      'a locale not offered',
      () => request(app!.getHttpServer()).get('/api/v1/tags?locale=fr'),
      400,
    ],
    [
      'a slug that is not lowercase words',
      () =>
        request(app!.getHttpServer())
          .post('/api/v1/tags')
          .send({ slug: 'Remote Work', label: 'x', reason: REASON }),
      400,
    ],
    [
      'a label of spaces',
      () =>
        request(app!.getHttpServer())
          .post('/api/v1/tags')
          .send({ slug: 'remote', label: '  ', reason: REASON }),
      400,
    ],
    [
      'a reason too short to say anything',
      () =>
        request(app!.getHttpServer())
          .post('/api/v1/tags')
          .send({ slug: 'remote', label: 'Remote', reason: 'ok' }),
      400,
    ],
    [
      'a label in a locale not offered',
      () =>
        request(app!.getHttpServer())
          .put(`/api/v1/tags/${ID}/labels/fr`)
          .send({ label: 'x', reason: REASON }),
      422,
    ],
    [
      'a merge into something that is not an id',
      () =>
        request(app!.getHttpServer())
          .post(`/api/v1/tags/${ID}/merge`)
          .send({ intoId: 'abroad', reason: REASON }),
      400,
    ],
    [
      'a tag id that is not an id',
      () =>
        request(app!.getHttpServer())
          .post('/api/v1/tags/remote/deprecate')
          .send({ reason: REASON }),
      400,
    ],
  ] as const)('refuses %s', async (_what, send, status) => {
    const s = {
      list: vi.fn(),
      create: vi.fn(),
      setLabel: vi.fn(),
      deprecate: vi.fn(),
      merge: vi.fn(),
    };
    app = await make(s);
    expect((await send()).status).toBe(status);
    for (const fn of Object.values(s)) expect(fn).not.toHaveBeenCalled();
  });
});
