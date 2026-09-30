import { type INestApplication } from '@nestjs/common';
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
import { validationPipe } from '../../common/validation/pipe';
import { BlockReviewController, BlocksController } from './blocks.controller';
import { BlocksService } from './blocks.service';

const ID = '00000000-0000-4000-8000-0000000000a8';
const me = testActor({ userId: '00000000-0000-4000-8000-0000000000b8', roles: ['CUSTOMER'] });

/** What the block routes accept before the service is reached (T-052). Whom a block names is the service's. */
describe('block routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (
    blocks: Partial<BlocksService>,
    who: ReturnType<typeof testActor> | null = me,
  ) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BlocksController, BlockReviewController],
      providers: [
        { provide: BlocksService, useValue: blocks },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (who === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return who;
            },
          },
        },
        workspaceResolverStub(me),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('refuses anyone not signed in', async () => {
    const block = vi.fn();
    app = await make({ block }, null);
    const http = request(app.getHttpServer());
    for (const [method, path] of [
      ['post', '/api/v1/blocks'],
      ['get', '/api/v1/blocks'],
      ['delete', `/api/v1/blocks/${ID}`],
      ['get', '/api/v1/block-review/live-assignments'],
      ['get', '/api/v1/block-review/signals'],
    ] as const) {
      expect((await http[method](path)).status, `${method} ${path}`).toBe(401);
    }
    expect(block).not.toHaveBeenCalled();
  });

  it('routes each action to the service, as the caller, and never lets an answer be cached', async () => {
    const made = { id: ID, source: 'profile', label: 'Ani', liveAssignments: 0 };
    const svc = {
      block: vi.fn().mockResolvedValue(made),
      list: vi.fn().mockResolvedValue([made]),
      unblock: vi.fn().mockResolvedValue(undefined),
      liveAssignments: vi.fn().mockResolvedValue([]),
      signals: vi.fn().mockResolvedValue([]),
    };
    app = await make(svc);
    const http = request(app.getHttpServer());

    const blocked = await http.post('/api/v1/blocks').send({ investigatorProfileId: ID });
    expect([blocked.status, blocked.body, blocked.headers['cache-control']]).toEqual([
      200,
      made,
      'no-store',
    ]);
    expect((await http.get('/api/v1/blocks')).body).toEqual({ items: [made] });
    expect((await http.delete(`/api/v1/blocks/${ID}`)).status).toBe(204);
    expect((await http.get('/api/v1/block-review/live-assignments')).body).toEqual({ items: [] });
    expect((await http.get('/api/v1/block-review/signals')).body).toEqual({ items: [] });

    expect(svc.block.mock.calls[0]?.slice(0, 2)).toEqual([me, { investigatorProfileId: ID }]);
    expect(svc.list.mock.calls[0]?.[0]).toEqual(me);
    expect(svc.unblock.mock.calls[0]?.slice(0, 2)).toEqual([me, ID]);
    expect(svc.liveAssignments.mock.calls[0]?.[0]).toEqual(me);
    expect(svc.signals.mock.calls[0]?.[0]).toEqual(me);
  });

  it.each([
    ['a target that is not an id', 'post', '/api/v1/blocks', { missionId: 'nope' }],
    ['a user id, which is not a way to name anyone', 'post', '/api/v1/blocks', { userId: ID }],
    ['an unblock of something that is not an id', 'delete', '/api/v1/blocks/nope', undefined],
  ] as const)('refuses %s', async (_, method, path, body) => {
    const svc = { block: vi.fn(), unblock: vi.fn() };
    app = await make(svc);
    const response = await request(app.getHttpServer())[method](path).send(body);
    expect(response.status).toBe(400);
    expect(svc.block).not.toHaveBeenCalled();
    expect(svc.unblock).not.toHaveBeenCalled();
  });
});
