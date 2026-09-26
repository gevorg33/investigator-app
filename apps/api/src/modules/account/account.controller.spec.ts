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
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { validationPipe } from '../../common/validation/pipe';

const ACTOR = testActor({ userId: 'u1', roles: ['CUSTOMER'] });
const VIEW = { id: 'u1', email: 'a@example.test', locale: 'ru', timezone: 'Asia/Yerevan' };

describe('account controller (T-127)', () => {
  let app: INestApplication;
  let account: { me: ReturnType<typeof vi.fn>; updatePreferences: ReturnType<typeof vi.fn> };

  const build = async (actor: typeof ACTOR | null) => {
    account = {
      me: vi.fn().mockResolvedValue(VIEW),
      updatePreferences: vi.fn().mockResolvedValue(VIEW),
    };
    const mod = await Test.createTestingModule({
      controllers: [AccountController],
      providers: [
        { provide: AccountService, useValue: account },
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
    app.useGlobalPipes(validationPipe());
    app.useGlobalFilters(new AppExceptionFilter());
    await listenOnce(app);
  };

  beforeEach(() => build(ACTOR));
  afterEach(async () => {
    await closeApp(app);
  });

  it('answers who is signed in', async () => {
    const res = await request(app.getHttpServer()).get('/me');
    expect([res.status, res.body]).toEqual([200, VIEW]);
    expect(account.me).toHaveBeenCalledWith(ACTOR);
  });

  it('saves only the preferences sent, for the caller — never an account named in the body', async () => {
    const res = await request(app.getHttpServer())
      .patch('/me/preferences')
      .send({ timezone: 'Europe/Moscow' });
    expect(res.status).toBe(200);
    expect(account.updatePreferences).toHaveBeenCalledWith(
      ACTOR,
      { locale: undefined, timezone: 'Europe/Moscow' },
      expect.anything(),
    );
    const other = await request(app.getHttpServer())
      .patch('/me/preferences')
      .send({ userId: 'u2', locale: 'hy' });
    expect(other.status).toBe(400);
  });

  it.each([
    ['a language the platform does not speak', { locale: 'de' }],
    ['a time zone that does not exist', { timezone: 'Nowhere/Land' }],
    ['a fixed offset', { timezone: '+04:00' }],
  ])('refuses %s', async (_label, body) => {
    const res = await request(app.getHttpServer()).patch('/me/preferences').send(body);
    expect(res.status).toBe(400);
    expect(account.updatePreferences).not.toHaveBeenCalled();
  });

  it('is for signed-in callers only', async () => {
    await closeApp(app);
    await build(null);
    expect((await request(app.getHttpServer()).get('/me')).status).toBe(401);
    expect(
      (await request(app.getHttpServer()).patch('/me/preferences').send({ locale: 'hy' })).status,
    ).toBe(401);
  });
});
