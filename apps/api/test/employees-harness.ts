import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MAILER, type MailMessage } from '../src/common/mail/mailer';
import { TokenService } from '../src/modules/auth/token.service';
import { TEST_DATABASE_URL, testPool } from './db';
import { closeApp, listenOnce } from './http';
import { agency, member } from './workspace-fixtures';

/**
 * The whole application over HTTP, for employees (T-085): real sessions, the resolver reading
 * memberships per request, row-level security as the runtime role — so "refused on the next
 * request" is shown by making the next request. Mail is captured instead of logged, which is how a
 * spec reads the link an invitation sends.
 */
export async function employeesApp() {
  const saved = { ...process.env };
  process.env['DATABASE_URL'] = TEST_DATABASE_URL;
  process.env['REDIS_URL'] ??= 'redis://localhost:6380';
  process.env['SESSION_SECRET'] ??= 'x'.repeat(48);
  process.env['NODE_ENV'] = 'test';
  process.env['APP_BASE_URL'] = 'http://app.test';
  const owner = testPool({ role: 'owner' });
  const mails: MailMessage[] = [];
  // Imported only now: AppModule validates the environment the moment it is loaded.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAILER)
    .useValue({ send: async (m: MailMessage) => void mails.push(m) })
    .compile();
  const app: INestApplication = mod.createNestApplication();
  await configureApp(app);
  await listenOnce(app);

  /** Someone signed in, with a confirmed address, and the cookie their browser would send. */
  const signedIn = async () => {
    const who = await member(owner);
    const token = `e2e-${randomUUID()}`;
    await owner`
      UPDATE user_sessions SET refresh_token_hash = ${new TokenService().fingerprint(token)}
       WHERE id = ${who.actor.sessionId}`;
    const [row] = await owner<
      { email: string }[]
    >`SELECT email FROM users WHERE id = ${who.actor.userId}`;
    return { ...who, email: row!.email, cookie: `investigator_session=${token}` };
  };
  type Person = Awaited<ReturnType<typeof signedIn>>;

  /** An agency whose first person is its OWNER and the rest hold the roles given. */
  const agencyOf = async (people: ReadonlyArray<{ who: Person; role?: string }>) =>
    agency(
      owner,
      people.map((p) => ({
        userId: p.who.actor.userId,
        ...(p.role !== undefined && { role: p.role }),
      })),
    );

  /** A request as `who`, in `workspace` when one is named. */
  const as = (who: Person, workspace?: string) => {
    const http = request(app.getHttpServer());
    const withHeaders = (r: request.Test) => {
      r.set('Cookie', who.cookie);
      if (workspace !== undefined) r.set('X-Workspace', workspace);
      return r;
    };
    return {
      get: (path: string) => withHeaders(http.get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withHeaders(http.post(`/api/v1${path}`)).send(body),
      patch: (path: string, body: object) => withHeaders(http.patch(`/api/v1${path}`)).send(body),
      put: (path: string, body: object) => withHeaders(http.put(`/api/v1${path}`)).send(body),
    };
  };

  /** The token in the last invitation mailed to `email`. */
  const tokenFor = (email: string): string => {
    const mail = [...mails].reverse().find((m) => m.to === email);
    if (mail === undefined) throw new Error(`no invitation mailed to ${email}`);
    return new URL(mail.variables['url']!).searchParams.get('token')!;
  };

  const close = async () => {
    await closeApp(app);
    await owner.end();
    process.env = saved;
  };

  return { app, owner, mails, signedIn, agencyOf, as, tokenFor, close };
}
