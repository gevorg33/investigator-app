import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../../test/actor';
import { workspaceResolverStub } from '../../../../test/context';
import { closeApp, listenOnce } from '../../../../test/http';
import { ActorService } from '../../../common/authz/actor.service';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { AppExceptionFilter } from '../../../common/errors/http-exception.filter';
import { validationPipe } from '../../../common/validation/pipe';
import { AiPlansController } from './ai-plans.controller';
import { AiPlansService } from './ai-plans.service';

const SESSION = '00000000-0000-4000-8000-0000000000a1';
const PLAN = '00000000-0000-4000-8000-0000000000b2';
const HASH = 'c'.repeat(64);
const me = testActor({ userId: '00000000-0000-4000-8000-0000000000f6' });

/** What the plan routes accept before the service is reached (T-048). Whose it is, is the service's. */
describe('assistant plan routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (plans: Partial<AiPlansService>, who: typeof me | null = me) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AiPlansController],
      providers: [
        { provide: AiPlansService, useValue: plans },
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
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };
  const base = `/api/v1/ai/sessions/${SESSION}/plans`;

  it('refuses anyone not signed in, and confirms nothing', async () => {
    const confirm = vi.fn();
    app = await make({ confirm }, null);
    const res = await request(app.getHttpServer())
      .post(`${base}/${PLAN}/confirm`)
      .send({ planHash: HASH });
    expect(res.status).toBe(401);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('routes reading, confirming and declining to the service, with the caller', async () => {
    const s = {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: PLAN }),
      confirm: vi.fn().mockResolvedValue({ id: PLAN }),
      decline: vi.fn().mockResolvedValue({ id: PLAN }),
    };
    app = await make(s);
    const http = request(app.getHttpServer());

    expect((await http.get(`${base}?open=true`)).status).toBe(200);
    expect((await http.get(base)).status).toBe(200);
    expect((await http.get(`${base}/${PLAN}`)).status).toBe(200);
    expect((await http.post(`${base}/${PLAN}/confirm`).send({ planHash: HASH })).status).toBe(200);
    expect((await http.post(`${base}/${PLAN}/decline`)).status).toBe(200);

    expect(s.list.mock.calls.map((c) => c.slice(0, 3))).toEqual([
      [me, SESSION, { open: true }],
      [me, SESSION, { open: false }],
    ]);
    expect(s.get.mock.calls[0]?.slice(0, 3)).toEqual([me, SESSION, PLAN]);
    expect(s.confirm.mock.calls[0]?.slice(0, 4)).toEqual([me, SESSION, PLAN, HASH]);
    expect(s.decline.mock.calls[0]?.slice(0, 3)).toEqual([me, SESSION, PLAN]);
  });

  it.each([
    ['no hash', `/${PLAN}/confirm`, {}],
    ['a hash that is not one', `/${PLAN}/confirm`, { planHash: 'yes' }],
    ['a field the server owns', `/${PLAN}/confirm`, { planHash: HASH, confirmedRole: 'STAFF' }],
    ['a plan id that is not one', '/latest/confirm', { planHash: HASH }],
  ] as const)('refuses %s', async (_what, path, body) => {
    const confirm = vi.fn();
    app = await make({ confirm });
    const res = await request(app.getHttpServer()).post(`${base}${path}`).send(body);
    expect(res.status).toBe(400);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses a session id that is not one, and an unknown filter', async () => {
    const list = vi.fn();
    app = await make({ list });
    const http = request(app.getHttpServer());
    expect((await http.get('/api/v1/ai/sessions/mine/plans')).status).toBe(400);
    expect((await http.get(`${base}?open=maybe`)).status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});
