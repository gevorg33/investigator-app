import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/actor';
import { assignment } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
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
import { AppError } from '../../common/errors/app-error';
import * as schema from '../../database/schema';
import { assignments, auditLogs, quotes, userBlocks } from '../../database/schema';
import { BLOCK_SIGNAL_THRESHOLD, BlocksService } from './blocks.service';

/**
 * Blocking, through the service, against the real database (T-052).
 *
 * What a block takes away is held underneath (`test/isolation/blocks.spec.ts`). What the service
 * adds is whom it names, from where the blocker stands; what it follows through on — the
 * blocker's own open quotes, and never a live assignment; the audit trail; and the two lists staff
 * act on.
 */
describe('blocks', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: BlocksService;
  const req = () => ({ ip: '198.51.100.52', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(
      new BlocksService(db, new AuthzService(audit), audit, new PlatformContext(audit)),
      owner,
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  // What the rows say, in a fixed order — not when: `occurred_at` is the writing transaction's
  // start, so rows written together tie and a clock step reorders separate ones, and the table has no
  // write-order column. The audit claims which events were recorded, not their sequence (T-180).
  const auditOf = (actorId: string) =>
    ownerDb
      .select({
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        reason: auditLogs.reason,
      })
      .from(auditLogs)
      .where(eq(auditLogs.actorId, actorId))
      .orderBy(auditLogs.action, auditLogs.resourceId);

  /** Gives an investigator a pseudonym, unique as the table requires, and returns it. */
  const pseudonymOf = async (profileId: string) => {
    const pseudonym = `North Star ${randomUUID().slice(0, 8)}`;
    await ownerDb
      .update(schema.investigatorProfiles)
      .set({ pseudonym })
      .where(eq(schema.investigatorProfiles.id, profileId));
    return pseudonym;
  };

  const statusOf = async (quoteId: string) =>
    (await ownerDb.select().from(quotes).where(eq(quotes.id, quoteId)))[0]!.status;

  const staff = (scope: 'DISPUTES' | 'ENFORCEMENT') =>
    testActor({ userId: randomUUID(), roles: ['STAFF'], staffScopes: [scope] });

  const expectCode = async (p: Promise<unknown>, code: string) => {
    const error = await p.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return error as AppError;
  };

  describe('from a profile', () => {
    it('labels an investigator who has not chosen a pseudonym by nothing, never their legal name (T-181)', async () => {
      const { actor: customer } = await quotableMission(ownerDb);
      const unnamed = await eligibleInvestigator(ownerDb, { displayName: 'Gor Unchosen' });
      const made = await service.block(
        customer,
        { investigatorProfileId: unnamed.profileId },
        req(),
      );
      expect(made).toMatchObject({ label: null, investigatorProfileId: unnamed.profileId });
      expect(JSON.stringify(await service.list(customer, req()))).not.toContain('Unchosen');
    });

    it('names the investigator by the name the customer could see, once however often asked', async () => {
      const { actor: customer } = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb, { displayName: 'Ani Petrosyan' });
      // Customers know an investigator by the pseudonym they chose, never the legal name (T-181).
      const known = await pseudonymOf(inv.profileId);

      const first = await service.block(customer, { investigatorProfileId: inv.profileId }, req());
      expect(first).toMatchObject({
        source: 'profile',
        label: known,
        investigatorProfileId: inv.profileId,
        liveAssignments: 0,
      });
      const again = await service.block(customer, { investigatorProfileId: inv.profileId }, req());
      expect(again.id).toBe(first.id);

      expect(await service.list(customer, req())).toEqual([
        {
          id: first.id,
          source: 'profile',
          label: known,
          investigatorProfileId: inv.profileId,
          createdAt: first.createdAt,
        },
      ]);
      expect(await auditOf(customer.userId)).toEqual([
        {
          action: 'user.blocked',
          resourceType: 'user',
          resourceId: inv.actor.userId,
          reason: null,
        },
      ]);
    });

    it('cannot reach a profile that is not public, or oneself', async () => {
      const { actor: customer } = await quotableMission(ownerDb);
      const hidden = await eligibleInvestigator(ownerDb);
      await ownerDb
        .update(schema.investigatorProfiles)
        .set({ visibility: 'DRAFT' })
        .where(eq(schema.investigatorProfiles.id, hidden.profileId));
      await expectCode(
        service.block(customer, { investigatorProfileId: hidden.profileId }, req()),
        'NOT_FOUND',
      );
      await expectCode(
        service.block(customer, { investigatorProfileId: randomUUID() }, req()),
        'NOT_FOUND',
      );

      const me = await eligibleInvestigator(ownerDb);
      const self = await expectCode(
        service.block(me.actor, { investigatorProfileId: me.profileId }, req()),
        'VALIDATION_FAILED',
      );
      expect(self.details).toEqual([
        { field: 'target', code: 'SELF', messageKey: 'error.validation.block.self' },
      ]);
    });

    it.each([
      ['nothing', {}],
      ['two things', { investigatorProfileId: randomUUID(), missionId: randomUUID() }],
    ])('refuses a block naming %s', async (_, target) => {
      const { actor } = await quotableMission(ownerDb);
      const error = await expectCode(service.block(actor, target, req()), 'VALIDATION_FAILED');
      expect(error.details).toEqual([
        { field: 'target', code: 'ONE_OF', messageKey: 'error.validation.block.target' },
      ]);
    });
  });

  describe('from a mission', () => {
    it('names its customer without a name, and withdraws the investigator’s open quotes to them', async () => {
      const mission = await quotableMission(ownerDb);
      const second = await quotableMission(ownerDb, { customerId: mission.customerId });
      const elsewhere = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const open = await submittedQuote(ownerDb, {
        missionId: second.missionId,
        investigatorProfileId: inv.profileId,
      });
      const unrelated = await submittedQuote(ownerDb, {
        missionId: elsewhere.missionId,
        investigatorProfileId: inv.profileId,
      });
      // Someone else's quote to the same customer is theirs to keep.
      const rival = await eligibleInvestigator(ownerDb);
      const rivals = await submittedQuote(ownerDb, {
        missionId: second.missionId,
        investigatorProfileId: rival.profileId,
      });

      const block = await service.block(inv.actor, { missionId: mission.missionId }, req());
      expect(block).toMatchObject({ source: 'mission', label: null, investigatorProfileId: null });

      expect(await statusOf(open.id)).toBe('WITHDRAWN');
      expect(await statusOf(unrelated.id)).toBe('SUBMITTED');
      expect(await statusOf(rivals.id)).toBe('SUBMITTED');
      expect(await auditOf(inv.actor.userId)).toEqual([
        {
          action: 'quote.withdrawn',
          resourceType: 'quote',
          resourceId: open.id,
          reason: 'blocked',
        },
        {
          action: 'user.blocked',
          resourceType: 'user',
          resourceId: mission.customerId,
          reason: null,
        },
      ]);
    });

    it('cannot reach a mission the investigator cannot see', async () => {
      const draft = await quotableMission(ownerDb, { status: 'DRAFT' });
      const inv = await eligibleInvestigator(ownerDb);
      await expectCode(
        service.block(inv.actor, { missionId: draft.missionId }, req()),
        'NOT_FOUND',
      );
    });

    it('finishes a block whose follow-through did not happen when it is made again', async () => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      await service.block(inv.actor, { missionId: mission.missionId }, req());
      // As if the quote had been offered as the block was made, and missed.
      const late = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
      });
      await service.block(inv.actor, { missionId: mission.missionId }, req());
      expect(await statusOf(late.id)).toBe('WITHDRAWN');
    });
  });

  describe('during an assignment', () => {
    const live = async (status: 'IN_PROGRESS' | 'COMPLETED' = 'IN_PROGRESS') => {
      const mission = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb, { displayName: 'Davit Hakobyan' });
      const known = await pseudonymOf(inv.profileId);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: inv.profileId,
        status: 'ACCEPTED',
      });
      await ownerDb
        .update(schema.users)
        .set({ displayName: 'Mariam Sargsyan' })
        .where(eq(schema.users.id, mission.customerId));
      const row = await assignment(ownerDb, {
        quoteId: quote.id,
        customerId: mission.customerId,
        status,
      });
      return { customer: mission.actor, inv: { ...inv, known }, assignmentId: row.id };
    };

    it('labels a hired customer with no name on their account by nothing', async () => {
      const a = await live();
      await ownerDb
        .update(schema.users)
        .set({ displayName: null })
        .where(eq(schema.users.id, a.customer.userId));
      const made = await service.block(a.inv.actor, { assignmentId: a.assignmentId }, req());
      expect(made).toMatchObject({ source: 'assignment', label: null });
    });

    it('leaves the work running and hands it to staff, whichever side blocks', async () => {
      const a = await live();
      const byCustomer = await service.block(a.customer, { assignmentId: a.assignmentId }, req());
      expect(byCustomer).toMatchObject({
        source: 'assignment',
        // The investigator by their pseudonym (T-181); the customer, below, by name — the
        // investigator was hired, so T-100 no longer masks them.
        label: a.inv.known,
        investigatorProfileId: a.inv.profileId,
        liveAssignments: 1,
      });
      const b = await live();
      const byInvestigator = await service.block(
        b.inv.actor,
        { assignmentId: b.assignmentId },
        req(),
      );
      expect(byInvestigator).toMatchObject({ label: 'Mariam Sargsyan', liveAssignments: 1 });

      for (const id of [a.assignmentId, b.assignmentId]) {
        const [row] = await ownerDb.select().from(assignments).where(eq(assignments.id, id));
        expect(row!.status).toBe('IN_PROGRESS');
      }
      expect((await auditOf(a.customer.userId)).map((e) => e.action)).toEqual([
        'block.live_assignment',
        'user.blocked',
      ]);

      const flags = await service.liveAssignments(staff('DISPUTES'), req());
      expect(flags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockId: byCustomer.id,
            blockedBy: 'CUSTOMER',
            assignmentId: a.assignmentId,
            assignmentStatus: 'IN_PROGRESS',
          }),
          expect.objectContaining({
            blockId: byInvestigator.id,
            blockedBy: 'INVESTIGATOR',
            assignmentId: b.assignmentId,
          }),
        ]),
      );
    });

    it('does not flag work already finished', async () => {
      const done = await live('COMPLETED');
      const block = await service.block(done.customer, { assignmentId: done.assignmentId }, req());
      expect(block.liveAssignments).toBe(0);
      const flags = await service.liveAssignments(staff('DISPUTES'), req());
      expect(flags.map((f) => f.blockId)).not.toContain(block.id);
    });

    it('cannot reach an assignment the caller is not party to', async () => {
      const a = await live();
      const stranger = await eligibleInvestigator(ownerDb);
      await expectCode(
        service.block(stranger.actor, { assignmentId: a.assignmentId }, req()),
        'NOT_FOUND',
      );
    });
  });

  describe('unblocking', () => {
    it('removes the caller’s own block, and answers anyone else’s as not there', async () => {
      const { actor: customer } = await quotableMission(ownerDb);
      const inv = await eligibleInvestigator(ownerDb);
      const block = await service.block(customer, { investigatorProfileId: inv.profileId }, req());

      await expectCode(service.unblock(inv.actor, block.id, req()), 'NOT_FOUND');
      await service.unblock(customer, block.id, req());
      expect(await service.list(customer, req())).toEqual([]);
      await expectCode(service.unblock(customer, block.id, req()), 'NOT_FOUND');
      expect((await auditOf(customer.userId)).map((e) => e.action)).toEqual([
        'user.blocked',
        'user.unblocked',
      ]);
    });
  });

  describe('what staff see', () => {
    it(`surfaces an account blocked by ${BLOCK_SIGNAL_THRESHOLD} people, and not by fewer`, async () => {
      const many = await eligibleInvestigator(ownerDb);
      const few = await eligibleInvestigator(ownerDb);
      for (let i = 0; i < BLOCK_SIGNAL_THRESHOLD; i++) {
        const { actor } = await quotableMission(ownerDb);
        await service.block(actor, { investigatorProfileId: many.profileId }, req());
        if (i > 0) await service.block(actor, { investigatorProfileId: few.profileId }, req());
      }
      const signals = await service.signals(staff('ENFORCEMENT'), req());
      expect(signals).toContainEqual({
        userId: many.actor.userId,
        blockedBy: BLOCK_SIGNAL_THRESHOLD,
        lastBlockedAt: expect.any(Date),
      });
      expect(signals.map((s) => s.userId)).not.toContain(few.actor.userId);
    });

    it.each([
      ['a customer', () => testActor({ userId: randomUUID(), roles: ['CUSTOMER'] })],
      ['staff of another area', () => staff('ENFORCEMENT')],
    ])('keeps the live-assignment list from %s', async (_, who) => {
      await expectCode(service.liveAssignments(who() as Actor, req()), 'FORBIDDEN');
    });

    it('keeps the signals from staff of another area', async () => {
      await expectCode(service.signals(staff('DISPUTES'), req()), 'FORBIDDEN');
    });
  });

  it('keeps a block to its blocker even inside their own list query', async () => {
    const { actor: customer } = await quotableMission(ownerDb);
    const inv = await eligibleInvestigator(ownerDb);
    await service.block(customer, { investigatorProfileId: inv.profileId }, req());
    expect(await service.list(inv.actor, req())).toEqual([]);
    const [row] = await ownerDb
      .select()
      .from(userBlocks)
      .where(
        and(eq(userBlocks.blockerId, customer.userId), eq(userBlocks.blockedId, inv.actor.userId)),
      );
    expect(row).toBeDefined();
  });
});
