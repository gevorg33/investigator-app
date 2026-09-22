import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignment } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import {
  eligibleInvestigator,
  quotableMission,
  submittedQuote,
} from '../../../test/quote-fixtures';
import { asRequests, inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { assignments, auditLogs, investigationSources } from '../../database/schema';
import { InvestigationSourcesService, SOURCES_WRITABLE } from './investigation-sources.service';

type Status = (typeof schema.assignmentStatus.enumValues)[number];

describe('investigation sources (T-031)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: InvestigationSourcesService;
  const req = () => ({ ip: '198.51.100.31', userAgent: 'vitest', correlationId: randomUUID() });

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

  /** A live assignment: its customer, its investigator, and the id both refer to it by. */
  const work = async (status: Status = 'IN_PROGRESS') => {
    const mission = await quotableMission(ownerDb);
    const investigator = await eligibleInvestigator(ownerDb);
    const quote = await submittedQuote(ownerDb, {
      missionId: mission.missionId,
      investigatorProfileId: investigator.profileId,
    });
    const row = await assignment(ownerDb, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status,
    });
    return { customer: mission.actor, investigator: investigator.actor, id: row.id };
  };

  const moveTo = (id: string, status: Status) =>
    ownerDb
      .update(assignments)
      .set({ status, acceptedAt: status === 'PENDING_ACCEPTANCE' ? null : new Date() })
      .where(eq(assignments.id, id));

  const record = (actor: Actor, id: string, over: Record<string, unknown> = {}) =>
    service.create(
      actor,
      id,
      { type: 'REGISTRY', title: 'Company register extract', ...over },
      req(),
    );

  const auditOf = (sourceId: string, action: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, sourceId), eq(auditLogs.action, action)));

  describe('recording', () => {
    it('records a source as private and of unknown reliability unless told otherwise', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id, {
        locator: 'https://registry.example.test/42',
      });
      expect([source.shared, source.reliability, source.addedBy]).toEqual([
        false,
        'UNKNOWN',
        investigator.userId,
      ]);
    });

    it('audits the kind of source, never its title — a title can name a person', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id, {
        type: 'WITNESS',
        title: 'Neighbour at 12 Example St',
      });
      const [entry] = await auditOf(source.id, 'investigation_source.created');
      expect(entry?.reason).toBe('WITNESS');
      expect(JSON.stringify(entry)).not.toContain('Neighbour');
    });

    it('wants the reason for any reliability judgement, and none for UNKNOWN', async () => {
      const { investigator, id } = await work();
      await expect(record(investigator, id, { reliability: 'HIGH' })).rejects.toMatchObject({
        status: 422,
        details: [expect.objectContaining({ field: 'reliabilityRationale', code: 'REQUIRED' })],
      });
      await expect(
        record(investigator, id, { reliability: 'LOW', reliabilityRationale: '   ' }),
      ).rejects.toMatchObject({ status: 422 });
      const judged = await record(investigator, id, {
        reliability: 'HIGH',
        reliabilityRationale: 'Official register, extract dated and stamped',
      });
      expect(judged.reliability).toBe('HIGH');
    });

    it('keeps the date it was consulted, since a register extract is only true as of one', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id, { accessedAt: '2026-09-01T10:00:00.000Z' });
      expect(source.accessedAt).toBe('2026-09-01T10:00:00.000Z');
    });
  });

  describe('who sees what', () => {
    it('shows the investigator every live source, and the customer only the shared ones', async () => {
      const { customer, investigator, id } = await work();
      const kept = await record(investigator, id, { title: 'Private working source' });
      const shared = await record(investigator, id, { title: 'Court record', shared: true });

      expect((await service.list(investigator, id, req())).map((s) => s.id)).toEqual([
        kept.id,
        shared.id,
      ]);
      expect((await service.list(customer, id, req())).map((s) => s.id)).toEqual([shared.id]);
    });

    it('takes a withdrawn source out of both views', async () => {
      const { customer, investigator, id } = await work();
      const source = await record(investigator, id, { shared: true });
      await service.withdraw(investigator, id, source.id, req());
      expect(await service.list(investigator, id, req())).toEqual([]);
      expect(await service.list(customer, id, req())).toEqual([]);
    });

    it('is not a catalogue: another assignment’s source is out of reach, even for the same investigator', async () => {
      const first = await work();
      const source = await record(first.investigator, first.id);
      // A second assignment for the same investigator, from another customer.
      const mission = await quotableMission(ownerDb);
      const [profile] = await ownerDb
        .select({ id: schema.investigatorProfiles.id })
        .from(schema.investigatorProfiles)
        .where(eq(schema.investigatorProfiles.userId, first.investigator.userId));
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: profile!.id,
      });
      const second = await assignment(ownerDb, {
        quoteId: quote.id,
        customerId: mission.customerId,
        status: 'IN_PROGRESS',
      });

      expect(await service.list(first.investigator, second.id, req())).toEqual([]);
      await expect(
        service.update(first.investigator, second.id, source.id, { shared: true }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.withdraw(first.investigator, second.id, source.id, req()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('correcting and sharing', () => {
    it('corrects a source and records which fields moved, not what they now say', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      const fixed = await service.update(
        investigator,
        id,
        source.id,
        { title: 'Company register extract, certified', locator: 'REG-2026-0042' },
        req(),
      );
      expect(fixed.title).toBe('Company register extract, certified');
      const [entry] = await auditOf(source.id, 'investigation_source.updated');
      expect(entry?.reason).toBe('changed: title, locator');
    });

    it('says when a source becomes visible to the customer', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      await service.update(investigator, id, source.id, { shared: true }, req());
      const [entry] = await auditOf(source.id, 'investigation_source.updated');
      expect(entry?.reason).toBe('changed: shared (now shared)');
    });

    it('takes a source back out of the customer’s sight, and says so', async () => {
      const { customer, investigator, id } = await work();
      const source = await record(investigator, id, { shared: true });
      await service.update(investigator, id, source.id, { shared: false }, req());
      expect(await service.list(customer, id, req())).toEqual([]);
      const reasons = (await auditOf(source.id, 'investigation_source.updated')).map(
        (e) => e.reason,
      );
      expect(reasons).toEqual(['changed: shared (now private)']);
    });

    it('judges reliability in an edit, with its reason, and corrects when it was consulted', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      const judged = await service.update(
        investigator,
        id,
        source.id,
        {
          reliability: 'MEDIUM',
          reliabilityRationale: 'Self-published, but consistent with the register',
          accessedAt: '2026-08-30T09:00:00.000Z',
        },
        req(),
      );
      expect([judged.reliability, judged.reliabilityRationale, judged.accessedAt]).toEqual([
        'MEDIUM',
        'Self-published, but consistent with the register',
        '2026-08-30T09:00:00.000Z',
      ]);
    });

    it('records nothing when nothing changed', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      await service.update(investigator, id, source.id, { title: source.title }, req());
      expect(await auditOf(source.id, 'investigation_source.updated')).toEqual([]);
    });

    it('holds the rationale rule across an edit, not only at creation', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      await expect(
        service.update(investigator, id, source.id, { reliability: 'MEDIUM' }, req()),
      ).rejects.toMatchObject({ status: 422 });
    });

    it('finds a withdrawn source gone: it cannot be edited or withdrawn again', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      await service.withdraw(investigator, id, source.id, req());
      await expect(
        service.update(investigator, id, source.id, { shared: true }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.withdraw(investigator, id, source.id, req())).rejects.toMatchObject({
        status: 404,
      });
      expect(await auditOf(source.id, 'investigation_source.withdrawn')).toHaveLength(1);
    });
  });

  describe('while the work is live, and only then', () => {
    it.each([...SOURCES_WRITABLE])('accepts sources while %s', async (status) => {
      const { investigator, id } = await work(status);
      await expect(record(investigator, id)).resolves.toMatchObject({ assignmentId: id });
    });

    it.each(['PENDING_ACCEPTANCE', 'COMPLETED', 'CANCELLED', 'SUSPENDED'] as const)(
      'refuses every write while %s, and still lets both sides read',
      async (status) => {
        const { customer, investigator, id } = await work('IN_PROGRESS');
        const source = await record(investigator, id, { shared: true });
        await moveTo(id, status);

        await expect(record(investigator, id)).rejects.toMatchObject({ status: 403 });
        await expect(
          service.update(investigator, id, source.id, { title: 'Too late' }, req()),
        ).rejects.toMatchObject({ status: 403 });
        await expect(service.withdraw(investigator, id, source.id, req())).rejects.toMatchObject({
          status: 403,
        });
        expect(await service.list(investigator, id, req())).toHaveLength(1);
        expect(await service.list(customer, id, req())).toHaveLength(1);
      },
    );
  });

  /**
   * The rules hold without the service. Row-level security is what stops a customer reading a
   * private source even through a query the service never wrote.
   */
  describe('the database holds the lines itself', () => {
    // Awaited inside the context: a drizzle query is lazy, and one handed back un-awaited runs
    // after the context has ended — with no workspace at all, so a refusal would prove nothing
    // about the policy. Found while writing T-031; this helper had that bug in T-053.
    const asWorkspaceOf = <T>(
      userId: string,
      fn: (db: ReturnType<typeof scopedDb>) => Promise<T>,
    ) => inWorkspaceOf(owner, userId, async () => await fn(scopedDb(sql)));

    it('lets the customer’s workspace read shared, unwithdrawn sources and nothing else', async () => {
      const { customer, investigator, id } = await work();
      await record(investigator, id, { title: 'Private' });
      const shared = await record(investigator, id, { shared: true });
      const withdrawn = await record(investigator, id, { shared: true });
      await service.withdraw(investigator, id, withdrawn.id, req());

      const seen = await asWorkspaceOf(customer.userId, (db) =>
        db.select({ id: investigationSources.id }).from(investigationSources),
      );
      expect(seen.map((s) => s.id)).toEqual([shared.id]);
    });

    it('refuses the customer’s workspace any write', async () => {
      const { customer, investigator, id } = await work();
      const shared = await record(investigator, id, { shared: true });
      await expect(
        asWorkspaceOf(customer.userId, (db) =>
          db.insert(investigationSources).values({
            assignmentId: id,
            type: 'OTHER',
            title: 'Planted',
            addedBy: customer.userId,
          }),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
      });
      const changed = await asWorkspaceOf(customer.userId, (db) =>
        db
          .update(investigationSources)
          .set({ title: 'Edited by the customer' })
          .where(eq(investigationSources.id, shared.id))
          .returning(),
      );
      expect(changed).toEqual([]);
    });

    it('never lets the application delete one, from either side', async () => {
      const { investigator, id } = await work();
      const source = await record(investigator, id);
      await expect(
        asWorkspaceOf(investigator.userId, (db) =>
          db.delete(investigationSources).where(eq(investigationSources.id, source.id)),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
      });
    });

    it('keeps a source on its assignment, and a withdrawal final', async () => {
      const a = await work();
      const b = await work();
      const source = await record(a.investigator, a.id);
      await expect(
        owner`UPDATE investigation_sources SET assignment_id = ${b.id} WHERE id = ${source.id}`,
      ).rejects.toThrow();
      await service.withdraw(a.investigator, a.id, source.id, req());
      await expect(
        owner`UPDATE investigation_sources SET withdrawn_at = NULL WHERE id = ${source.id}`,
      ).rejects.toThrow(/stays withdrawn/);
    });

    it('refuses a reliability judgement with no rationale, whoever writes it', async () => {
      const { investigator, id } = await work();
      await expect(
        owner`INSERT INTO investigation_sources (assignment_id, type, title, reliability, added_by)
              VALUES (${id}, 'WEBSITE', 'x', 'HIGH', ${investigator.userId})`,
      ).rejects.toThrow(/investigation_sources_rationale_when_judged/);
    });
  });

  describe('what it is not', () => {
    it('never fetches a locator — nothing in the module can make a request', () => {
      // A locator is where the investigator looked. Fetching it server-side would be an SSRF
      // path to anything the API can reach, so the module holds no way to do it; a feature that
      // needs one comes with an allowlist, and this test is where that becomes a decision.
      const dir = __dirname;
      const code = readdirSync(dir)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
        .map((f) => readFileSync(join(dir, f), 'utf8'))
        .join('\n');
      expect(code).not.toMatch(/\bfetch\(|from 'node:https?'|from 'https?'|axios|undici|got\b/);
    });

    it('carries reliability of the source, not confidence in a claim (ADR-0005)', () => {
      const columns = Object.keys(investigationSources);
      expect(columns.filter((c) => /confidence|assertion|contradict|certainty/i.test(c))).toEqual(
        [],
      );
    });
  });
});
