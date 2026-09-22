import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { assignment } from '../../../test/assignment-fixtures';
import { expectAuthorized } from '../../../test/authz-cases';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { assignments } from '../../database/schema';
import { InvestigationSourcesService } from './investigation-sources.service';

/**
 * The seven cases, for the write and for the read (`authorization`, T-031).
 *
 * The one that matters most is the second: a different investigator, or a different customer,
 * asking about an assignment that is not theirs gets 404 — the same answer as an id that does
 * not exist, so the question "is this a real assignment?" goes unanswered too.
 */
describe('who may touch an assignment’s sources', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: InvestigationSourcesService;
  const req = () => ({ ip: '198.51.100.32', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new InvestigationSourcesService(db, new AuthzService(audit), audit),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const work = async () => {
    const mission = await quotableMission(ownerDb);
    const investigator = await eligibleInvestigator(ownerDb);
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: investigator.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status: 'IN_PROGRESS',
    });
    return { customer: mission.actor, investigator: investigator.actor, id: row.id };
  };

  it('lets only the assignment’s investigator record a source', async () => {
    const { customer, investigator, id } = await work();
    const stranger = (await eligibleInvestigator(ownerDb)).actor;
    const suspended = testActor({ ...investigator, status: 'SUSPENDED' });
    const staff = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['DISPUTES'] });

    await expectAuthorized(
      (actor) => service.create(actor, id, { type: 'DOCUMENT', title: 'Signed statement' }, req()),
      {
        owner: investigator,
        otherOfSameRole: stranger,
        wrongRole: customer,
        suspended,
        wrongState: {
          actor: investigator,
          setup: async () => {
            await ownerDb
              .update(assignments)
              .set({ status: 'COMPLETED' })
              .where(eq(assignments.id, id));
          },
        },
        // No staff scope writes an investigator's sources; dispute review reads them (T-118).
        staffOutsideScope: staff,
      },
    );
  });

  it('shows sources to the assignment’s two parties, and 404s everyone else', async () => {
    const { customer, investigator, id } = await work();
    const otherCustomer = (await quotableMission(ownerDb)).actor;
    const otherInvestigator = (await eligibleInvestigator(ownerDb)).actor;

    await expect(service.list(investigator, id, req())).resolves.toEqual([]);
    await expect(service.list(customer, id, req())).resolves.toEqual([]);
    for (const outsider of [otherCustomer, otherInvestigator]) {
      await expect(service.list(outsider, id, req())).rejects.toMatchObject({ status: 404 });
    }
    // And an assignment that does not exist looks exactly the same.
    await expect(service.list(investigator, randomUUID(), req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a suspended account the read as well', async () => {
    const { investigator, id } = await work();
    await expect(
      service.list(testActor({ ...investigator, status: 'SUSPENDED' }), id, req()),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('gives a non-participant who knows a source id nothing to edit or withdraw', async () => {
    const { investigator, id } = await work();
    const source = await service.create(investigator, id, { type: 'WEBSITE', title: 'x' }, req());
    const stranger = (await eligibleInvestigator(ownerDb)).actor;
    await expect(
      service.update(stranger, id, source.id, { shared: true }, req()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.withdraw(stranger, id, source.id, req())).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps a customer who is also an investigator from writing to their own purchase', async () => {
    // Holding the INVESTIGATOR role is not being this assignment's investigator.
    const { customer, id } = await work();
    const both: Actor = testActor({ ...customer, roles: ['CUSTOMER', 'INVESTIGATOR'] });
    await expect(
      service.create(both, id, { type: 'OTHER', title: 'x' }, req()),
    ).rejects.toMatchObject({ status: 404 });
  });
});
