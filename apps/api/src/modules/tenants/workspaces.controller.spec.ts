import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testActor } from '../../../test/actor';
import { workspaceResolverStub } from '../../../test/context';
import { closeApp, listenOnce } from '../../../test/http';
import { ActorService } from '../../common/authz/actor.service';
import { AppExceptionFilter } from '../../common/errors/http-exception.filter';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { validationPipe } from '../../common/validation/pipe';

const ACTOR = testActor({ userId: 'u1' });
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('workspaces controller', () => {
  let app: INestApplication;
  let workspaces: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(async () => {
    workspaces = {
      list: vi.fn().mockResolvedValue([]),
      activate: vi.fn().mockResolvedValue({ id: ID }),
    };
    const mod = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [
        { provide: WorkspacesService, useValue: workspaces },
        { provide: ActorService, useValue: { fromRefreshToken: async () => ACTOR } },
        workspaceResolverStub(ACTOR),
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  });

  afterEach(async () => {
    await closeApp(app);
  });

  const http = () => request(app.getHttpServer());

  it('lists the caller’s workspaces', async () => {
    expect((await http().get('/workspaces')).status).toBe(200);
    expect(workspaces['list']).toHaveBeenCalledWith(ACTOR, expect.any(Object));
  });

  it('activates by id, answering 200', async () => {
    const res = await http().post(`/workspaces/${ID}/activate`).send({});
    expect(res.status).toBe(200);
    expect(workspaces['activate']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await http().post('/workspaces/not-a-uuid/activate').send({})).status).toBe(400);
    expect(workspaces['activate']).not.toHaveBeenCalled();
  });

  it('never takes a workspace from a body: only the path is read', async () => {
    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await http().post(`/workspaces/${ID}/activate`).send({ tenantId: other, id: other });
    expect(workspaces['activate']).toHaveBeenCalledWith(ACTOR, ID, expect.any(Object));
  });
});
