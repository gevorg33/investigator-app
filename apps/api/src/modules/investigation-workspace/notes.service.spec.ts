import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assignment } from '../../../test/assignment-fixtures';
import { testPool } from '../../../test/db';
import { person } from '../../../test/media-fixtures';
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
import { assignments, auditLogs, investigationNotes } from '../../database/schema';
import { WORKSPACE_WRITABLE } from './assignment-access';
import { NotesService } from './notes.service';

type Status = (typeof schema.assignmentStatus.enumValues)[number];

describe('investigation notes (T-032)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: NotesService;
  const req = () => ({ ip: '198.51.100.40', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = asRequests(new NotesService(db, new AuthzService(audit), audit), owner);
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
    return {
      customer: mission.actor,
      investigator: investigator.actor,
      profileId: investigator.profileId,
      id: row.id,
    };
  };

  const moveTo = (id: string, status: Status) =>
    ownerDb
      .update(assignments)
      .set({ status, acceptedAt: status === 'PENDING_ACCEPTANCE' ? null : new Date() })
      .where(eq(assignments.id, id));

  const write = (actor: Actor, id: string, over: Record<string, unknown> = {}) =>
    service.create(actor, id, { body: 'Subject may use a second trading name', ...over }, req());

  const auditOf = (noteId: string, action: string) =>
    ownerDb
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, noteId), eq(auditLogs.action, action)));

  describe('writing', () => {
    it('writes a note as private, by the investigator who wrote it', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      expect([note.visibility, note.authorId, note.body]).toEqual([
        'PRIVATE',
        investigator.userId,
        'Subject may use a second trading name',
      ]);
    });

    it('audits that a note was written and how visible it is, never what it says', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id, { body: 'Neighbour at 12 Example St saw him' });
      const [entry] = await auditOf(note.id, 'investigation_note.created');
      expect([entry?.reason, entry?.actorId]).toEqual(['PRIVATE', investigator.userId]);
      expect(JSON.stringify(entry)).not.toContain('Neighbour');
    });

    it('refuses a note of only spaces as a field error, not as a 500 from the database', async () => {
      const { investigator, id } = await work();
      await expect(write(investigator, id, { body: '   ' })).rejects.toMatchObject({
        status: 422,
        details: [
          {
            field: 'body',
            code: 'REQUIRED',
            messageKey: 'error.validation.investigation_workspace.blank',
          },
        ],
      });
    });

    it('keeps the text as written, less the spaces around it', async () => {
      const { investigator, id } = await work();
      expect((await write(investigator, id, { body: '  Checked the register.  ' })).body).toBe(
        'Checked the register.',
      );
    });
  });

  describe('who sees what', () => {
    it('shows the author their notes, and the customer only the shared ones', async () => {
      const { customer, investigator, id } = await work();
      const kept = await write(investigator, id, { body: 'A line of inquiry, not yet checked' });
      const shared = await write(investigator, id, {
        body: 'Address confirmed',
        visibility: 'SHARED',
      });

      expect((await service.list(investigator, id, req())).map((n) => n.id)).toEqual([
        kept.id,
        shared.id,
      ]);
      expect((await service.list(customer, id, req())).map((n) => n.id)).toEqual([shared.id]);
    });

    it('takes a deleted note out of both views', async () => {
      const { customer, investigator, id } = await work();
      const note = await write(investigator, id, { visibility: 'SHARED' });
      await service.remove(investigator, id, note.id, req());
      expect(await service.list(investigator, id, req())).toEqual([]);
      expect(await service.list(customer, id, req())).toEqual([]);
    });

    it('is not a catalogue: another assignment’s note is out of reach, even for its author', async () => {
      const first = await work();
      const note = await write(first.investigator, first.id);
      const mission = await quotableMission(ownerDb);
      const quote = await submittedQuote(ownerDb, {
        missionId: mission.missionId,
        investigatorProfileId: first.profileId,
      });
      const second = await assignment(ownerDb, {
        quoteId: quote.id,
        customerId: mission.customerId,
        status: 'IN_PROGRESS',
      });

      expect(await service.list(first.investigator, second.id, req())).toEqual([]);
      await expect(
        service.update(first.investigator, second.id, note.id, { body: 'Moved' }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        service.remove(first.investigator, second.id, note.id, req()),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('editing and sharing', () => {
    it('edits a note as often as the thinking moves — it is not evidence', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      await service.update(
        investigator,
        id,
        note.id,
        { body: 'Second trading name: ruled out' },
        req(),
      );
      const last = await service.update(
        investigator,
        id,
        note.id,
        { body: 'Second trading name: ruled out, see register' },
        req(),
      );
      expect(last.body).toBe('Second trading name: ruled out, see register');
      const entries = await auditOf(note.id, 'investigation_note.updated');
      expect(entries.map((e) => e.reason)).toEqual(['body', 'body']);
      expect(JSON.stringify(entries)).not.toContain('ruled out');
    });

    it('records who shared a note with the customer, as an action of its own', async () => {
      const { customer, investigator, id } = await work();
      const note = await write(investigator, id);
      await service.update(investigator, id, note.id, { visibility: 'SHARED' }, req());

      const [entry] = await auditOf(note.id, 'investigation_note.visibility_changed');
      expect([entry?.reason, entry?.actorId, entry?.actorRole]).toEqual([
        'PRIVATE -> SHARED',
        investigator.userId,
        'INVESTIGATOR',
      ]);
      expect(await auditOf(note.id, 'investigation_note.updated')).toEqual([]);
      expect((await service.list(customer, id, req())).map((n) => n.id)).toEqual([note.id]);
    });

    it('takes a note back out of the customer’s sight, and says so', async () => {
      const { customer, investigator, id } = await work();
      const note = await write(investigator, id, { visibility: 'SHARED' });
      await service.update(investigator, id, note.id, { visibility: 'PRIVATE' }, req());
      expect(await service.list(customer, id, req())).toEqual([]);
      const reasons = (await auditOf(note.id, 'investigation_note.visibility_changed')).map(
        (e) => e.reason,
      );
      expect(reasons).toEqual(['SHARED -> PRIVATE']);
    });

    it('records an edit and a share made together as the two things they are', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      await service.update(
        investigator,
        id,
        note.id,
        { body: 'Address confirmed', visibility: 'SHARED' },
        req(),
      );
      expect(await auditOf(note.id, 'investigation_note.updated')).toHaveLength(1);
      expect(await auditOf(note.id, 'investigation_note.visibility_changed')).toHaveLength(1);
    });

    it('records nothing when nothing changed', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      const same = await service.update(
        investigator,
        id,
        note.id,
        { body: ` ${note.body} `, visibility: 'PRIVATE' },
        req(),
      );
      expect(same.updatedAt).toBe(note.updatedAt);
      expect(await auditOf(note.id, 'investigation_note.updated')).toEqual([]);
      expect(await auditOf(note.id, 'investigation_note.visibility_changed')).toEqual([]);
    });

    it('refuses an edit that would leave nothing', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      await expect(
        service.update(investigator, id, note.id, { body: ' ' }, req()),
      ).rejects.toMatchObject({
        status: 422,
        details: [expect.objectContaining({ field: 'body' })],
      });
    });

    it('finds a deleted note gone: it cannot be edited or deleted again, and was audited once', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      await service.remove(investigator, id, note.id, req());
      await expect(
        service.update(investigator, id, note.id, { visibility: 'SHARED' }, req()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(service.remove(investigator, id, note.id, req())).rejects.toMatchObject({
        status: 404,
      });
      const [entry, ...more] = await auditOf(note.id, 'investigation_note.deleted');
      expect([entry?.reason, entry?.actorId, more]).toEqual(['PRIVATE', investigator.userId, []]);
    });
  });

  describe('while the work is live, and only then', () => {
    it.each([...WORKSPACE_WRITABLE])('takes notes while %s', async (status) => {
      const { investigator, id } = await work(status);
      await expect(write(investigator, id)).resolves.toMatchObject({ assignmentId: id });
    });

    it.each(['PENDING_ACCEPTANCE', 'COMPLETED', 'CANCELLED', 'SUSPENDED'] as const)(
      'refuses every write while %s, and still lets both sides read',
      async (status) => {
        const { customer, investigator, id } = await work('IN_PROGRESS');
        const note = await write(investigator, id, { visibility: 'SHARED' });
        await moveTo(id, status);

        await expect(write(investigator, id)).rejects.toMatchObject({ status: 403 });
        await expect(
          service.update(investigator, id, note.id, { body: 'Too late' }, req()),
        ).rejects.toMatchObject({ status: 403 });
        await expect(service.remove(investigator, id, note.id, req())).rejects.toMatchObject({
          status: 403,
        });
        expect(await service.list(investigator, id, req())).toHaveLength(1);
        expect(await service.list(customer, id, req())).toHaveLength(1);
      },
    );
  });

  /**
   * The rules hold without the service. Row-level security is what keeps a private note its
   * author's even through a query the service never wrote — a colleague's, an agency owner's.
   */
  describe('the database holds the lines itself', () => {
    const asWorkspaceOf = <T>(
      userId: string,
      fn: (db: ReturnType<typeof scopedDb>) => Promise<T>,
    ) => inWorkspaceOf(owner, userId, async () => await fn(scopedDb(sql)));

    /** As the runtime role, in `tenantId`, as `userId` — whoever that is, member or not. */
    const asUserIn = <T>(
      tenantId: string,
      userId: string,
      fn: (tx: postgres.TransactionSql) => Promise<T>,
    ) =>
      sql.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true),
                        set_config('app.user_id', ${userId}, true)`;
        return fn(tx);
      }) as Promise<T>;

    it('lets the customer’s workspace read shared, undeleted notes and nothing else', async () => {
      const { customer, investigator, id } = await work();
      await write(investigator, id, { body: 'Private' });
      const shared = await write(investigator, id, { visibility: 'SHARED' });
      const deleted = await write(investigator, id, { visibility: 'SHARED' });
      await service.remove(investigator, id, deleted.id, req());

      const seen = await asWorkspaceOf(customer.userId, (db) =>
        db.select({ id: investigationNotes.id }).from(investigationNotes),
      );
      expect(seen.map((n) => n.id)).toEqual([shared.id]);
    });

    it('keeps a private note from anyone else in the author’s own workspace — an agency owner too', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      const shared = await write(investigator, id, { visibility: 'SHARED' });
      const [row] = await ownerDb
        .select({ supplier: investigationNotes.supplierTenantId })
        .from(investigationNotes)
        .where(eq(investigationNotes.id, note.id));
      const colleague = await person(ownerDb, { roles: ['INVESTIGATOR'] });

      const seen = await asUserIn(
        row!.supplier,
        colleague.userId,
        (tx) =>
          tx<{ id: string }[]>`SELECT id FROM investigation_notes WHERE assignment_id = ${id}`,
      );
      expect(seen).toEqual([]);
      // Shared is for the assignment's parties, not the rest of a workspace (T-089 decides staff).
      expect(seen.map((n) => n.id)).not.toContain(shared.id);
      const changed = await asUserIn(
        row!.supplier,
        colleague.userId,
        (tx) =>
          tx`UPDATE investigation_notes SET body = 'Overwritten' WHERE id = ${note.id} RETURNING id`,
      );
      expect(changed).toHaveLength(0);
      // And its author, in the same workspace, reads it.
      const own = await asUserIn(
        row!.supplier,
        investigator.userId,
        (tx) => tx<{ id: string }[]>`SELECT id FROM investigation_notes WHERE id = ${note.id}`,
      );
      expect(own).toHaveLength(1);
    });

    it('refuses to write a note in someone else’s name', async () => {
      const { investigator, id } = await work();
      const [row] = await owner<{ supplier: string }[]>`
        SELECT supplier_tenant_id AS supplier FROM assignments WHERE id = ${id}`;
      await expect(
        asUserIn(
          row!.supplier,
          investigator.userId,
          (tx) =>
            tx`INSERT INTO investigation_notes (assignment_id, author_id, body)
             VALUES (${id}, ${randomUUID()}, 'Written for someone else')`,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('refuses the customer’s workspace any write', async () => {
      const { customer, investigator, id } = await work();
      const shared = await write(investigator, id, { visibility: 'SHARED' });
      await expect(
        asWorkspaceOf(customer.userId, (db) =>
          db.insert(investigationNotes).values({
            assignmentId: id,
            authorId: customer.userId,
            body: 'Planted',
          }),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
      });
      const changed = await asWorkspaceOf(customer.userId, (db) =>
        db
          .update(investigationNotes)
          .set({ body: 'Edited by the customer' })
          .where(eq(investigationNotes.id, shared.id))
          .returning(),
      );
      expect(changed).toEqual([]);
    });

    it('never lets the application delete one, from either side', async () => {
      const { investigator, id } = await work();
      const note = await write(investigator, id);
      await expect(
        asWorkspaceOf(investigator.userId, (db) =>
          db.delete(investigationNotes).where(eq(investigationNotes.id, note.id)),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }),
      });
    });

    it('keeps a note on its assignment and with its author, and a deletion final', async () => {
      const a = await work();
      const b = await work();
      const note = await write(a.investigator, a.id);
      await expect(
        owner`UPDATE investigation_notes SET assignment_id = ${b.id} WHERE id = ${note.id}`,
      ).rejects.toThrow();
      await expect(
        owner`UPDATE investigation_notes SET author_id = ${b.investigator.userId} WHERE id = ${note.id}`,
      ).rejects.toThrow(/stays with its assignment and its author/);
      await service.remove(a.investigator, a.id, note.id, req());
      await expect(
        owner`UPDATE investigation_notes SET deleted_at = NULL WHERE id = ${note.id}`,
      ).rejects.toThrow(/stays deleted/);
    });

    it('does not go with its assignment: the assignment cannot be deleted from under it', async () => {
      const { investigator, id } = await work();
      await write(investigator, id);
      await expect(owner`DELETE FROM assignments WHERE id = ${id}`).rejects.toThrow(
        /investigation_notes/,
      );
    });

    it('refuses an empty note, whoever writes it', async () => {
      const { investigator, id } = await work();
      await expect(
        owner`INSERT INTO investigation_notes (assignment_id, author_id, body)
              VALUES (${id}, ${investigator.userId}, '  ')`,
      ).rejects.toThrow(/investigation_notes_body_length/);
    });
  });

  it('carries none of evidence’s semantics — no checksum, custody or access grant', () => {
    const columns = Object.keys(investigationNotes);
    expect(
      columns.filter((c) => /checksum|hash|custody|grant|sealed|immutable|confidence/i.test(c)),
    ).toEqual([]);
  });
});
