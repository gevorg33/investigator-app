import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, testPool } from '../../../test/db';
import { closeApp, listenOnce } from '../../../test/http';
import { eligibleInvestigator, inDays, quotableMission } from '../../../test/quote-fixtures';
import * as schema from '../../database/schema';
import { TokenService } from '../auth/token.service';

/**
 * Quoting through the whole stack (T-142): cookie → ActorGuard → workspace → QuotesService →
 * PostgreSQL. The service spec proves the rule; this proves a person who posts as a customer and
 * works as an investigator meets it over HTTP, as a 404 like any mission they may not quote on.
 */
describe('quoting, end to end', () => {
  const saved = { ...process.env };
  let app: INestApplication;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    process.env['DATABASE_URL'] = TEST_DATABASE_URL;
    process.env['REDIS_URL'] ??= 'redis://localhost:6380';
    process.env['SESSION_SECRET'] ??= 'x'.repeat(48);
    process.env['NODE_ENV'] = 'test';
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    // Imported only now: AppModule validates the environment the moment it is loaded.
    const { AppModule } = await import('../../app.module');
    const { configureApp } = await import('../../bootstrap');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await configureApp(app);
    await listenOnce(app);
  });

  afterAll(async () => {
    await closeApp(app);
    await owner.end();
    process.env = saved;
  });

  /** An eligible investigator who is also a customer, signed in with a real session. */
  const investigator = async () => {
    const inv = await eligibleInvestigator(ownerDb);
    await owner`
      INSERT INTO user_roles (user_id, role)
      VALUES (${inv.userId}, 'INVESTIGATOR'), (${inv.userId}, 'CUSTOMER')`;
    const token = `e2e-${randomUUID()}`;
    await owner`
      INSERT INTO user_sessions (user_id, refresh_token_hash, family_id, expires_at)
      VALUES (${inv.userId}, ${new TokenService().fingerprint(token)}, ${randomUUID()},
              now() + interval '1 day')`;
    return { ...inv, cookie: `__Host-investigator_session=${token}` };
  };

  const offer = {
    priceMinor: 250_000,
    currency: 'AMD',
    estimatedDurationDays: 14,
    scope: 'Records research at the declared business address.',
    deliverables: 'A written report with sources listed.',
    cancellationTerms: 'Full refund before work starts.',
    expiresAt: inDays(7).toISOString(),
  };
  const quote = (missionId: string, cookie: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/missions/${missionId}/quotes`)
      .set('Cookie', cookie)
      .send(offer);

  it('refuses a quote on the investigator’s own mission as not found, and takes one on another’s', async () => {
    const me = await investigator();
    const own = await quotableMission(ownerDb, { customerId: me.userId });
    const theirs = await quotableMission(ownerDb);

    const refused = await quote(own.missionId, me.cookie);
    expect(refused.status).toBe(404);
    expect(refused.body.error).toMatchObject({ code: 'NOT_FOUND' });

    const taken = await quote(theirs.missionId, me.cookie);
    expect(taken.status).toBe(201);
    expect(taken.body).toMatchObject({ missionId: theirs.missionId, status: 'SUBMITTED' });
  });
});
