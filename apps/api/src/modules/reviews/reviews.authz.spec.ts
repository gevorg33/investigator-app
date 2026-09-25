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
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import { assignments, reviewTexts, reviews } from '../../database/schema';
import { ReviewsService } from './reviews.service';

/**
 * Who may write, read, respond to, report and moderate a review (`authorization`, T-037).
 *
 * The case that matters most is the second: another customer or another investigator asking about
 * an assignment that is not theirs gets 404, the same answer as an id that does not exist.
 */
describe('who may touch a review', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: ReviewsService;
  let moderator: Actor;
  let otherStaff: Actor;
  const req = () => ({ ip: '198.51.100.38', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
    moderator = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['MODERATION'] });
    otherStaff = await person(ownerDb, { roles: ['STAFF'], staffScopes: ['DISPUTES'] });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new ReviewsService(db, new AuthzService(audit), audit, new PlatformContext(audit)),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const completed = async () => {
    const mission = await quotableMission(ownerDb);
    const investigator = await eligibleInvestigator(ownerDb);
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: investigator.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status: 'COMPLETED',
    });
    return {
      customer: mission.actor,
      investigator: investigator.actor,
      profileId: investigator.profileId,
      id: row.id,
    };
  };

  const strangers = async () => ({
    customer: (await quotableMission(ownerDb)).actor,
    investigator: (await eligibleInvestigator(ownerDb)).actor,
  });

  const suspended = (a: Actor) => testActor({ ...a, status: 'SUSPENDED' });

  it('lets only the assignment’s customer review it, and only once it is completed', async () => {
    const a = await completed();
    const other = await strangers();

    await expectAuthorized((actor) => service.create(actor, a.id, { rating: 4 }, req()), {
      owner: a.customer,
      otherOfSameRole: other.customer,
      wrongRole: a.investigator,
      suspended: suspended(a.customer),
      wrongState: {
        actor: a.customer,
        setup: async () => {
          await ownerDb
            .update(assignments)
            .set({ status: 'IN_PROGRESS' })
            .where(eq(assignments.id, a.id));
        },
      },
      staffOutsideScope: moderator,
    });
  });

  it('lets only the assignment’s investigator respond, and not to a removed review', async () => {
    const a = await completed();
    const other = await strangers();
    const review = await service.create(a.customer, a.id, { rating: 2 }, req());

    await expectAuthorized(
      (actor) => service.respond(actor, a.id, { text: 'We delivered what was quoted.' }, req()),
      {
        owner: a.investigator,
        otherOfSameRole: other.investigator,
        wrongRole: a.customer,
        suspended: suspended(a.investigator),
        wrongState: {
          actor: a.investigator,
          setup: async () => {
            await service.remove(
              moderator,
              review.id,
              { reason: 'Removed for the authorization test.' },
              req(),
            );
          },
        },
        staffOutsideScope: moderator,
      },
    );
  });

  it('lets only the other party report published words, once', async () => {
    const a = await completed();
    const other = await strangers();
    await service.create(a.customer, a.id, { rating: 1, text: 'Never turned up.' }, req());
    const [text] = await ownerDb
      .select({ id: reviewTexts.id })
      .from(reviewTexts)
      .innerJoin(reviews, eq(reviews.id, reviewTexts.reviewId))
      .where(eq(reviews.assignmentId, a.id));
    await service.moderate(moderator, text!.id, { decision: 'PUBLISH' }, req());

    await expectAuthorized(
      (actor) =>
        service.report(
          actor,
          a.id,
          { part: 'REVIEW', reason: 'We have the site photographs.' },
          req(),
        ),
      {
        owner: a.investigator,
        otherOfSameRole: other.investigator,
        suspended: suspended(a.investigator),
        // Reported already: the text is back in moderation and cannot be reported again.
        wrongState: { actor: a.investigator, setup: async () => undefined },
      },
    );
    // The customer is a party, but the review is their own.
    await expect(
      service.report(a.customer, a.id, { part: 'REVIEW', reason: 'Please take mine down.' }, req()),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('shows the review to its two parties, and 404s everyone else', async () => {
    const a = await completed();
    const other = await strangers();
    await service.create(a.customer, a.id, { rating: 5 }, req());

    await expect(service.getForParty(a.customer, a.id, req())).resolves.toMatchObject({
      rating: 5,
    });
    await expect(service.getForParty(a.investigator, a.id, req())).resolves.toMatchObject({
      rating: 5,
    });
    for (const outsider of [other.customer, other.investigator, moderator]) {
      await expect(service.getForParty(outsider, a.id, req())).rejects.toMatchObject({
        status: 404,
      });
    }
    await expect(service.getForParty(a.customer, randomUUID(), req())).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.getForParty(suspended(a.customer), a.id, req())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('shows a published profile’s reviews to anyone signed in and active', async () => {
    const a = await completed();
    const other = await strangers();
    for (const reader of [other.customer, other.investigator, a.customer, moderator]) {
      await expect(service.forProfile(reader, a.profileId, {}, req())).resolves.toMatchObject({
        summary: { count: 0 },
      });
    }
    await expect(
      service.forProfile(suspended(other.customer), a.profileId, {}, req()),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('keeps moderation to staff holding the moderation scope', async () => {
    const a = await completed();
    const review = await service.create(a.customer, a.id, { rating: 3, text: 'Adequate.' }, req());
    const [text] = await ownerDb
      .select({ id: reviewTexts.id })
      .from(reviewTexts)
      .where(eq(reviewTexts.reviewId, review.id));
    const attempts = {
      queue: (actor: Actor) => service.queue(actor, {}, req()),
      moderate: (actor: Actor) =>
        service.moderate(
          actor,
          text!.id,
          { decision: 'HIDE', reason: 'Testing the gate here.' },
          req(),
        ),
      remove: (actor: Actor) =>
        service.remove(actor, review.id, { reason: 'Testing who may remove a review.' }, req()),
    };

    for (const attempt of Object.values(attempts)) {
      for (const refused of [otherStaff, a.customer, a.investigator, suspended(moderator)]) {
        await expect(attempt(refused)).rejects.toMatchObject({ status: 403 });
      }
      await expect(attempt(moderator)).resolves.toBeDefined();
    }
    // Something that does not exist is a 404, even to staff.
    await expect(
      service.moderate(moderator, randomUUID(), { decision: 'PUBLISH' }, req()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.remove(
        moderator,
        randomUUID(),
        { reason: 'There is nothing here to remove.' },
        req(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
