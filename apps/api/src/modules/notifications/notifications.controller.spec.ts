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
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const ID = '00000000-0000-4000-8000-0000000000a6';
const me = testActor({ userId: '00000000-0000-4000-8000-0000000000b6', roles: ['CUSTOMER'] });
const base = '/api/v1/notifications';

/**
 * What the notification routes accept before the service is reached, and the unsubscribe pages
 * they render (T-036). Whose notifications are whose is the service's and the database's.
 */
describe('notification routes', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await closeApp(app);
    app = undefined;
  });

  const make = async (
    notifications: Partial<NotificationsService>,
    who: ReturnType<typeof testActor> | null = me,
  ) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notifications },
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

  it('refuses anyone not signed in, except at the unsubscribe link', async () => {
    const list = vi.fn();
    const localeFor = vi.fn().mockResolvedValue(undefined);
    app = await make({ list, localeFor }, null);
    const http = request(app.getHttpServer());
    for (const [method, path] of [
      ['get', base],
      ['get', `${base}/unread`],
      ['post', `${base}/read-all`],
      ['post', `${base}/${ID}/read`],
      ['get', `${base}/preferences`],
      ['put', `${base}/preferences`],
    ] as const) {
      expect((await http[method](path)).status, `${method} ${path}`).toBe(401);
    }
    expect(list).not.toHaveBeenCalled();
    expect((await http.get(`${base}/unsubscribe`)).status).toBe(200);
  });

  it('routes each action to the service, as the caller, and never lets a page be cached', async () => {
    const page = { items: [], nextCursor: null };
    const preferences = [{ category: 'activity', channel: 'email', enabled: false }];
    const svc = {
      list: vi.fn().mockResolvedValue(page),
      unread: vi.fn().mockResolvedValue(4),
      markAllRead: vi.fn().mockResolvedValue(undefined),
      markRead: vi.fn().mockResolvedValue(undefined),
      preferences: vi.fn().mockResolvedValue(preferences),
      setPreference: vi.fn().mockResolvedValue(preferences),
    };
    app = await make(svc);
    const http = request(app.getHttpServer());

    const listed = await http.get(`${base}?cursor=abc`);
    expect([listed.status, listed.body, listed.headers['cache-control']]).toEqual([
      200,
      page,
      'no-store',
    ]);
    expect((await http.get(`${base}/unread`)).body).toEqual({ count: 4 });
    expect((await http.post(`${base}/read-all`)).status).toBe(204);
    expect((await http.post(`${base}/${ID}/read`)).status).toBe(204);
    expect((await http.get(`${base}/preferences`)).body).toEqual({ preferences });
    const choice = { category: 'activity', channel: 'email', enabled: false };
    expect((await http.put(`${base}/preferences`).send(choice)).body).toEqual({ preferences });

    expect(svc.list.mock.calls[0]?.slice(0, 2)).toEqual([me, 'abc']);
    expect(svc.unread.mock.calls[0]?.[0]).toEqual(me);
    expect(svc.markAllRead.mock.calls[0]?.[0]).toEqual(me);
    expect(svc.markRead.mock.calls[0]?.slice(0, 2)).toEqual([me, ID]);
    expect(svc.preferences.mock.calls[0]?.[0]).toEqual(me);
    expect(svc.setPreference.mock.calls[0]?.slice(0, 2)).toEqual([me, choice]);
  });

  it.each([
    ['an id that is not one', 'post', `${base}/not-an-id/read`, undefined],
    ['a cursor too long to be ours', 'get', `${base}?cursor=${'x'.repeat(201)}`, undefined],
    [
      'a category there is not',
      'put',
      `${base}/preferences`,
      { category: 'security', channel: 'email', enabled: false },
    ],
    [
      'a channel there is not',
      'put',
      `${base}/preferences`,
      { category: 'activity', channel: 'sms', enabled: false },
    ],
    [
      'on or off as words',
      'put',
      `${base}/preferences`,
      { category: 'activity', channel: 'email', enabled: 'no' },
    ],
  ] as const)('refuses %s', async (_, method, path, body) => {
    const svc = { list: vi.fn(), markRead: vi.fn(), setPreference: vi.fn() };
    app = await make(svc);
    const response = await request(app.getHttpServer())[method](path).send(body);
    expect(response.status).toBe(400);
    expect(svc.list).not.toHaveBeenCalled();
    expect(svc.markRead).not.toHaveBeenCalled();
    expect(svc.setPreference).not.toHaveBeenCalled();
  });

  describe('the unsubscribe link', () => {
    const headers = (r: request.Response) => ({
      type: r.headers['content-type'],
      cache: r.headers['cache-control'],
      referrer: r.headers['referrer-policy'],
      csp: r.headers['content-security-policy'],
    });
    const expected = {
      type: 'text/html; charset=utf-8',
      cache: 'no-store',
      referrer: 'no-referrer',
      csp: "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    };

    it('only asks when opened — a scanner following it changes nothing', async () => {
      const unsubscribe = vi.fn();
      const localeFor = vi.fn().mockResolvedValue('hy');
      app = await make({ unsubscribe, localeFor }, null);
      const response = await request(app.getHttpServer()).get(`${base}/unsubscribe?token=a.b`);
      expect(response.status).toBe(200);
      expect(headers(response)).toEqual(expected);
      expect(response.text).toContain('<html lang="hy">');
      expect(response.text).toContain('Դադարեցնե՞լ այս նամակները');
      expect(response.text).toContain('<form method="post" action="?token=a.b">');
      expect(response.text).toContain('<meta name="robots" content="noindex">');
      expect(unsubscribe).not.toHaveBeenCalled();
    });

    it('carries the token into the form escaped, whatever it contains', async () => {
      app = await make({ localeFor: vi.fn().mockResolvedValue('en') }, null);
      const response = await request(app.getHttpServer()).get(
        `${base}/unsubscribe?token=${encodeURIComponent('"><script>x</script>')}`,
      );
      expect(response.text).not.toContain('<script>');
      expect(response.text).toContain('action="?token=%22%3E%3Cscript%3Ex%3C%2Fscript%3E"');
    });

    it('says a link that does not verify does not work, in English, with nothing to press', async () => {
      app = await make({ localeFor: vi.fn().mockResolvedValue(undefined) }, null);
      const response = await request(app.getHttpServer()).get(`${base}/unsubscribe`);
      expect(response.text).toContain('<html lang="en">');
      expect(response.text).toContain('This link does not work.');
      expect(response.text).not.toContain('<form');
    });

    it('stops the mail when posted — the page’s button, or a mail client’s one click', async () => {
      const unsubscribe = vi.fn().mockResolvedValue('done');
      const localeFor = vi.fn().mockResolvedValue('ru');
      app = await make({ unsubscribe, localeFor }, null);
      const response = await request(app.getHttpServer())
        .post(`${base}/unsubscribe?token=a.b`)
        .type('form')
        .send('List-Unsubscribe=One-Click');
      expect(response.status).toBe(200);
      expect(headers(response)).toEqual(expected);
      expect(response.text).toContain('<html lang="ru">');
      expect(unsubscribe.mock.calls[0]?.[0]).toBe('a.b');
    });

    it('says so when a posted link does nothing', async () => {
      const localeFor = vi.fn();
      app = await make({ unsubscribe: vi.fn().mockResolvedValue('invalid'), localeFor }, null);
      const response = await request(app.getHttpServer()).post(`${base}/unsubscribe?token=a.b`);
      expect(response.text).toContain('This link does not work.');
      expect(localeFor).not.toHaveBeenCalled();
    });
  });
});
