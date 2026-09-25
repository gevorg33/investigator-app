import { randomUUID } from 'node:crypto';
import { Controller, Get, Inject, Req, UseGuards, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, testPool } from '../../../test/db';
import { closeApp, listenOnce } from '../../../test/http';
import { agency, member } from '../../../test/workspace-fixtures';
import { DB, type Db } from '../../database/database.module';
import { TokenService } from '../../modules/auth/token.service';
import { CurrentActor } from '../authz/actor.decorator';
import { ActorGuard } from '../authz/actor.guard';
import type { Actor } from '../authz/contract';
import { AuthzService } from '../authz/authz.service';
import { requestContext } from '../http/request-context';

/**
 * The whole path, end to end (T-075): cookie → ActorGuard → WorkspaceResolver → ContextInterceptor
 * → the scoped client → PostgreSQL. A probe controller, registered only here, asks the database
 * what context it sees — the one thing no unit test of a single piece can show.
 */
@Controller('probe')
@UseGuards(ActorGuard)
class ProbeController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
  ) {}

  @Get('settings')
  async settings(): Promise<unknown> {
    const [row] = await this.db.execute(
      sql`SELECT current_setting('app.tenant_id', true) AS tenant,
                 current_setting('app.user_id', true) AS "user",
                 current_setting('app.membership_id', true) AS membership`,
    );
    return row;
  }

  /** A denial inside a transaction that then rolls back — the per-request-transaction trap. */
  @Get('deny-in-transaction')
  async denyInTransaction(@CurrentActor() actor: Actor, @Req() req: Request): Promise<void> {
    const { correlationId, ip } = requestContext(req);
    await this.db.transaction(async () => {
      await this.authz.stateAllows(actor, false, {
        action: 'probe.deny',
        resourceType: 'probe',
        correlationId,
        ipAddress: ip,
      });
    });
  }
}

describe('the execution context, end to end', () => {
  const saved = { ...process.env };
  let app: INestApplication;
  let owner: postgres.Sql;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['REDIS_URL'] ??= 'redis://localhost:6380';
    process.env['SESSION_SECRET'] ??= 'x'.repeat(48);
    process.env['NODE_ENV'] = 'test';
    owner = testPool({ role: 'owner' });
    // Imported only now: AppModule validates the environment the moment it is loaded, and
    // bootstrap.ts imports AppModule.
    const { AppModule } = await import('../../app.module');
    const { configureApp } = await import('../../bootstrap');
    const mod = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = mod.createNestApplication();
    await configureApp(app);
    await listenOnce(app);
  });

  afterAll(async () => {
    await closeApp(app);
    await owner.end();
    process.env = saved;
  });

  /** A real session the guard can resolve: the refresh token's fingerprint, stored as T-005 does. */
  const signedIn = async () => {
    const who = await member(owner);
    const token = `e2e-${randomUUID()}`;
    await owner`
      UPDATE user_sessions SET refresh_token_hash = ${new TokenService().fingerprint(token)}
       WHERE id = ${who.actor.sessionId}`;
    return { ...who, cookie: `investigator_session=${token}` };
  };

  const http = () => request(app.getHttpServer());

  it('runs a request with no header in the caller’s Personal workspace', async () => {
    const me = await signedIn();
    const res = await http().get('/api/v1/probe/settings').set('Cookie', me.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tenant: me.personalId, user: me.actor.userId });
  });

  it('runs a request in the workspace X-Workspace names, when the caller works there', async () => {
    const me = await signedIn();
    const { tenantId, memberships } = await agency(owner, [{ userId: me.actor.userId }]);
    const res = await http()
      .get('/api/v1/probe/settings')
      .set('Cookie', me.cookie)
      .set('X-Workspace', tenantId);
    expect(res.body).toEqual({
      tenant: tenantId,
      user: me.actor.userId,
      membership: memberships[0],
    });
  });

  it('refuses a workspace the caller is not in, before the handler runs', async () => {
    const me = await signedIn();
    const other = await signedIn();
    const res = await http()
      .get('/api/v1/probe/settings')
      .set('Cookie', me.cookie)
      .set('X-Workspace', other.personalId);
    expect(res.status).toBe(403);
  });

  it('marks the current workspace in the switcher', async () => {
    const me = await signedIn();
    const res = await http().get('/api/v1/workspaces').set('Cookie', me.cookie);
    expect(res.body).toEqual([expect.objectContaining({ id: me.personalId, current: true })]);
  });

  it('keeps a denial’s audit row even when the transaction around it rolls back', async () => {
    // Regression for the design: one transaction per request would have rolled this row back
    // with everything else, and a refusal nobody recorded is a refusal nobody can investigate.
    const me = await signedIn();
    const correlationId = `e2e-${randomUUID()}`;
    const res = await http()
      .get('/api/v1/probe/deny-in-transaction')
      .set('Cookie', me.cookie)
      .set('X-Request-Id', correlationId);
    expect(res.status).toBe(403);
    const rows = await owner`
      SELECT actor_id, reason FROM audit_logs
       WHERE action = 'authz.denied.probe.deny' AND actor_id = ${me.actor.userId}`;
    expect(rows).toEqual([{ actor_id: me.actor.userId, reason: 'state_forbids_action' }]);
  });
});
