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
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { validationPipe } from '../../common/validation/pipe';

const ASSIGNMENT = '00000000-0000-4000-8000-0000000000a4';
const NOTE = '00000000-0000-4000-8000-0000000000b4';
const TASK = '00000000-0000-4000-8000-0000000000d4';
const investigator = testActor({
  userId: '00000000-0000-4000-8000-0000000000c4',
  roles: ['INVESTIGATOR'],
});
const notesAt = `/api/v1/assignments/${ASSIGNMENT}/notes`;
const tasksAt = `/api/v1/assignments/${ASSIGNMENT}/tasks`;

/** What the routes accept before a service is reached (T-032). Who may is the services'. */
describe('investigation notes and tasks routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (
    services: { notes?: Partial<NotesService>; tasks?: Partial<TasksService> },
    who: ReturnType<typeof testActor> | null = investigator,
  ) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotesController, TasksController],
      providers: [
        { provide: NotesService, useValue: services.notes ?? {} },
        { provide: TasksService, useValue: services.tasks ?? {} },
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
    // As bootstrap.ts sets it: an undeclared field is refused, not dropped.
    instance.useGlobalPipes(validationPipe());
    instance.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(instance);
    return instance;
  };

  it('refuses anyone not signed in', async () => {
    const list = vi.fn();
    app = await make({ notes: { list }, tasks: { list } }, null);
    expect((await request(app.getHttpServer()).get(notesAt)).status).toBe(401);
    expect((await request(app.getHttpServer()).get(tasksAt)).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  describe('notes', () => {
    it('lists, writes, edits and deletes through the service, with the caller', async () => {
      const list = vi.fn().mockResolvedValue([]);
      const create = vi.fn().mockResolvedValue({ id: NOTE });
      const update = vi.fn().mockResolvedValue({ id: NOTE });
      const remove = vi.fn().mockResolvedValue(undefined);
      app = await make({ notes: { list, create, update, remove } });
      const http = request(app.getHttpServer());

      expect((await http.get(notesAt)).status).toBe(200);
      expect((await http.post(notesAt).send({ body: 'Checked the register' })).status).toBe(201);
      expect((await http.patch(`${notesAt}/${NOTE}`).send({ visibility: 'SHARED' })).status).toBe(
        200,
      );
      expect((await http.delete(`${notesAt}/${NOTE}`)).status).toBe(204);

      expect(list.mock.calls[0]?.slice(0, 2)).toEqual([investigator, ASSIGNMENT]);
      expect(create.mock.calls[0]?.slice(0, 3)).toEqual([
        investigator,
        ASSIGNMENT,
        { body: 'Checked the register' },
      ]);
      expect(update.mock.calls[0]?.slice(1, 4)).toEqual([
        ASSIGNMENT,
        NOTE,
        { visibility: 'SHARED' },
      ]);
      expect(remove.mock.calls[0]?.slice(1, 3)).toEqual([ASSIGNMENT, NOTE]);
    });

    it.each([
      ['no body', { body: undefined }],
      ['a body too long to be a note', { body: 'x'.repeat(20001) }],
      ['a visibility that does not exist', { visibility: 'PUBLIC' }],
      // Fields the server sets, and a client must not be able to.
      ['an author', { authorId: investigator.userId }],
      ['a deletion', { deletedAt: '2026-01-01T00:00:00.000Z' }],
      ['another assignment', { assignmentId: '00000000-0000-4000-8000-0000000000ff' }],
      ['a checksum, as if it were evidence', { checksum: 'abc' }],
    ])('refuses %s', async (_what, over) => {
      const create = vi.fn();
      app = await make({ notes: { create } });
      const res = await request(app.getHttpServer())
        .post(notesAt)
        .send({ body: 'Checked the register', ...over });
      expect(res.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('tasks', () => {
    it('lists, adds, edits, moves and deletes through the service, with the caller', async () => {
      const list = vi.fn().mockResolvedValue([]);
      const create = vi.fn().mockResolvedValue({ id: TASK });
      const update = vi.fn().mockResolvedValue({ id: TASK });
      const transition = vi.fn().mockResolvedValue({ id: TASK });
      const remove = vi.fn().mockResolvedValue(undefined);
      app = await make({ tasks: { list, create, update, transition, remove } });
      const http = request(app.getHttpServer());

      expect((await http.get(tasksAt)).status).toBe(200);
      expect(
        (await http.post(tasksAt).send({ title: 'Request the extract', dueOn: '2026-10-02' }))
          .status,
      ).toBe(201);
      expect(
        (await http.patch(`${tasksAt}/${TASK}`).send({ description: null, dueOn: null })).status,
      ).toBe(200);
      expect((await http.post(`${tasksAt}/${TASK}/transition`).send({ to: 'DONE' })).status).toBe(
        200,
      );
      expect((await http.delete(`${tasksAt}/${TASK}`)).status).toBe(204);

      expect(create.mock.calls[0]?.slice(0, 3)).toEqual([
        investigator,
        ASSIGNMENT,
        { title: 'Request the extract', dueOn: '2026-10-02' },
      ]);
      expect(update.mock.calls[0]?.slice(1, 4)).toEqual([
        ASSIGNMENT,
        TASK,
        { description: null, dueOn: null },
      ]);
      expect(transition.mock.calls[0]?.slice(1, 4)).toEqual([ASSIGNMENT, TASK, { to: 'DONE' }]);
      expect(remove.mock.calls[0]?.slice(1, 3)).toEqual([ASSIGNMENT, TASK]);
    });

    it.each([
      ['no title', { title: undefined }],
      ['a title too long to be one', { title: 'x'.repeat(201) }],
      ['a due date that is a moment, not a day', { dueOn: '2026-10-02T09:00:00.000Z' }],
      ['a due date that is not a date', { dueOn: '2026-02-30' }],
      ['a negative position', { position: -1 }],
      ['a fractional position', { position: 1.5 }],
      ['a visibility that does not exist', { visibility: 'TEAM' }],
      // A status is set by the server, and moved only through `transition`.
      ['a status', { status: 'DONE' }],
      ['a creator', { createdBy: investigator.userId }],
    ])('refuses a task with %s', async (_what, over) => {
      const create = vi.fn();
      app = await make({ tasks: { create } });
      const res = await request(app.getHttpServer())
        .post(tasksAt)
        .send({ title: 'Request the extract', ...over });
      expect(res.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    });

    it('refuses a status set by editing — a task moves only through its transition', async () => {
      const update = vi.fn();
      app = await make({ tasks: { update } });
      const res = await request(app.getHttpServer())
        .patch(`${tasksAt}/${TASK}`)
        .send({ status: 'DONE' });
      expect(res.status).toBe(400);
      expect(update).not.toHaveBeenCalled();
    });

    it.each([
      ['no destination', {}],
      ['a status that does not exist', { to: 'BLOCKED' }],
    ])('refuses a move with %s', async (_what, body) => {
      const transition = vi.fn();
      app = await make({ tasks: { transition } });
      const res = await request(app.getHttpServer())
        .post(`${tasksAt}/${TASK}/transition`)
        .send(body);
      expect(res.status).toBe(400);
      expect(transition).not.toHaveBeenCalled();
    });
  });

  it('refuses ids that are not ids', async () => {
    const list = vi.fn();
    const remove = vi.fn();
    app = await make({ notes: { list }, tasks: { remove } });
    const http = request(app.getHttpServer());
    expect((await http.get('/api/v1/assignments/latest/notes')).status).toBe(400);
    expect((await http.delete(`${tasksAt}/first`)).status).toBe(400);
    expect(list).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
