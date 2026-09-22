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
import { InvestigationSourcesController } from './investigation-sources.controller';
import { InvestigationSourcesService } from './investigation-sources.service';

const ASSIGNMENT = '00000000-0000-4000-8000-0000000000a3';
const SOURCE = '00000000-0000-4000-8000-0000000000b3';
const investigator = testActor({
  userId: '00000000-0000-4000-8000-0000000000c3',
  roles: ['INVESTIGATOR'],
});
const base = `/api/v1/assignments/${ASSIGNMENT}/sources`;

/** What the routes accept before the service is reached (T-031). Who may is the service's. */
describe('investigation source routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (
    sources: Partial<InvestigationSourcesService>,
    who: ReturnType<typeof testActor> | null = investigator,
  ) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [InvestigationSourcesController],
      providers: [
        { provide: InvestigationSourcesService, useValue: sources },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (who === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return who;
            },
          },
        },
        workspaceResolverStub(who ?? investigator),
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
    expect((await request(app.getHttpServer()).get(base)).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('lists, records, corrects and withdraws through the service, with the caller', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const create = vi.fn().mockResolvedValue({ id: SOURCE });
    const update = vi.fn().mockResolvedValue({ id: SOURCE });
    const withdraw = vi.fn().mockResolvedValue(undefined);
    app = await make({ list, create, update, withdraw });
    const http = request(app.getHttpServer());

    expect((await http.get(base)).status).toBe(200);
    expect(
      (await http.post(base).send({ type: 'REGISTRY', title: 'Register extract' })).status,
    ).toBe(201);
    expect((await http.patch(`${base}/${SOURCE}`).send({ shared: true })).status).toBe(200);
    expect((await http.post(`${base}/${SOURCE}/withdraw`)).status).toBe(204);

    expect(create.mock.calls[0]?.slice(0, 2)).toEqual([investigator, ASSIGNMENT]);
    expect(update.mock.calls[0]?.slice(1, 3)).toEqual([ASSIGNMENT, SOURCE]);
    expect(withdraw.mock.calls[0]?.slice(1, 3)).toEqual([ASSIGNMENT, SOURCE]);
  });

  it.each([
    ['a type that does not exist', { type: 'RUMOUR' }],
    ['no title', { title: undefined }],
    ['a title too long to be one', { title: 'x'.repeat(201) }],
    ['a date that is not one', { accessedAt: 'last Tuesday' }],
    ['a reliability that does not exist', { reliability: 'CERTAIN' }],
    // Fields the server sets, and a client must not be able to.
    ['who added it', { addedBy: investigator.userId }],
    ['a withdrawal', { withdrawnAt: '2026-01-01T00:00:00.000Z' }],
    ['another assignment', { assignmentId: '00000000-0000-4000-8000-0000000000ff' }],
  ])('refuses %s', async (_what, over) => {
    const create = vi.fn();
    app = await make({ create });
    const res = await request(app.getHttpServer())
      .post(base)
      .send({ type: 'REGISTRY', title: 'Register extract', ...over });
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses ids that are not ids', async () => {
    const list = vi.fn();
    app = await make({ list });
    expect(
      (await request(app.getHttpServer()).get('/api/v1/assignments/latest/sources')).status,
    ).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });
});
