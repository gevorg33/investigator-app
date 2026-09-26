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
import { TaxonomyController } from './taxonomy.controller';
import { TaxonomyService } from './taxonomy.service';
import { validationPipe } from '../../common/validation/pipe';

const ID = '00000000-0000-4000-8000-0000000000a1';
const curator = testActor({
  userId: '00000000-0000-4000-8000-0000000000c1',
  roles: ['STAFF'],
  staffScopes: ['TAXONOMY'],
});
const REASON = 'Agreed at the taxonomy review, see minutes 12';

/**
 * The HTTP surface (T-053): what the routes accept and refuse before the service is reached.
 * Who may write is the service's to decide, and `taxonomy.service.spec.ts` proves it.
 */
describe('taxonomy routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (
    taxonomy: Partial<TaxonomyService>,
    who: ReturnType<typeof testActor> | null = curator,
  ) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TaxonomyController],
      providers: [
        { provide: TaxonomyService, useValue: taxonomy },
        {
          provide: ActorService,
          useValue: {
            fromRefreshToken: async () => {
              if (who === null) throw new AppError(ErrorCode.UNAUTHENTICATED);
              return who;
            },
          },
        },
        workspaceResolverStub(who ?? curator),
      ],
    }).compile();
    const instance = moduleRef.createNestApplication();
    instance.setGlobalPrefix('api/v1');
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('refuses anyone not signed in, even to read', async () => {
    const tree = vi.fn();
    app = await make({ tree }, null);
    expect((await request(app.getHttpServer()).get('/api/v1/taxonomy')).status).toBe(401);
    expect(tree).not.toHaveBeenCalled();
  });

  it('reads the tree in the locale asked for', async () => {
    const tree = vi.fn().mockResolvedValue([]);
    app = await make({ tree });
    const res = await request(app.getHttpServer()).get('/api/v1/taxonomy?locale=hy');
    expect(res.status).toBe(200);
    expect(tree).toHaveBeenCalledWith('hy');
  });

  it('refuses a locale the platform does not speak', async () => {
    const tree = vi.fn();
    app = await make({ tree });
    expect((await request(app.getHttpServer()).get('/api/v1/taxonomy?locale=de')).status).toBe(400);
    expect(tree).not.toHaveBeenCalled();
  });

  it('reads one node by id, and refuses an id that is not one', async () => {
    const node = vi.fn().mockResolvedValue({ id: ID });
    app = await make({ node });
    expect((await request(app.getHttpServer()).get(`/api/v1/taxonomy/nodes/${ID}`)).status).toBe(
      200,
    );
    expect(node).toHaveBeenCalledWith(ID, undefined);
    expect(
      (await request(app.getHttpServer()).get('/api/v1/taxonomy/nodes/corporate')).status,
    ).toBe(400);
  });

  it('passes a well-formed node to the service, with the caller', async () => {
    const createNode = vi.fn().mockResolvedValue({ id: ID });
    app = await make({ createNode });
    const res = await request(app.getHttpServer()).post('/api/v1/taxonomy/nodes').send({
      slug: 'due-diligence',
      riskBand: 'STANDARD',
      label: 'Due diligence',
      reason: REASON,
    });
    expect(res.status).toBe(201);
    expect(createNode.mock.calls[0]?.[0]).toMatchObject({ userId: curator.userId });
  });

  it.each([
    ['a slug that is not kebab-case', { slug: 'Due Diligence' }],
    ['no risk band — the person adding a node has to decide it', { riskBand: undefined }],
    ['no English label', { label: undefined }],
    ['a reason too short to mean anything', { reason: 'because' }],
    ['a band that does not exist', { riskBand: 'LOW' }],
  ])('refuses %s', async (_what, over) => {
    const createNode = vi.fn();
    app = await make({ createNode });
    const res = await request(app.getHttpServer())
      .post('/api/v1/taxonomy/nodes')
      .send({
        slug: 'due-diligence',
        riskBand: 'STANDARD',
        label: 'Due diligence',
        reason: REASON,
        ...over,
      });
    expect(res.status).toBe(400);
    expect(createNode).not.toHaveBeenCalled();
  });

  it('refuses an attempt to move or rename a node — those fields do not exist on an edit', async () => {
    const updateNode = vi.fn();
    app = await make({ updateNode });
    for (const body of [{ parentId: ID }, { slug: 'renamed' }]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/taxonomy/nodes/${ID}`)
        .send({ ...body, reason: REASON });
      expect(res.status).toBe(400);
    }
    expect(updateNode).not.toHaveBeenCalled();
  });

  it('updates a node', async () => {
    const updateNode = vi.fn().mockResolvedValue({ id: ID });
    app = await make({ updateNode });
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/taxonomy/nodes/${ID}`)
      .send({ riskBand: 'HIGH', reason: REASON });
    expect(res.status).toBe(200);
    expect(updateNode.mock.calls[0]?.[1]).toBe(ID);
  });

  it('sets a label in a known locale, and refuses any other', async () => {
    const setLabel = vi.fn().mockResolvedValue({ id: ID });
    app = await make({ setLabel });
    const ok = await request(app.getHttpServer())
      .put(`/api/v1/taxonomy/nodes/${ID}/labels/ru`)
      .send({ label: 'Проверка', reason: REASON });
    expect(ok.status).toBe(200);
    expect(setLabel.mock.calls[0]?.slice(1, 3)).toEqual([ID, 'ru']);

    const bad = await request(app.getHttpServer())
      .put(`/api/v1/taxonomy/nodes/${ID}/labels/de`)
      .send({ label: 'Prüfung', reason: REASON });
    expect(bad.status).toBe(422);
    expect(setLabel).toHaveBeenCalledTimes(1);
  });
});
