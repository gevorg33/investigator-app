import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { investigationNotes } from '../../database/schema';
import { AssignmentAccess, authzContext, requireText } from './assignment-access';
import type { CreateNoteDto, UpdateNoteDto } from './investigation-workspace.dto';

type NoteRow = typeof investigationNotes.$inferSelect;

export interface NoteView {
  id: string;
  assignmentId: string;
  authorId: string;
  body: string;
  visibility: NoteRow['visibility'];
  createdAt: string;
  updatedAt: string;
}

/**
 * The investigator's notes inside an assignment (plan.md §8, T-032).
 *
 * **Private to the author by default, and the database decides it.** Which notes a reader gets
 * is settled by row-level security alone: `author_works` gives the author their own, and
 * `customer_reads_shared` gives the customer's workspace the shared, undeleted ones. The service
 * does not filter as well — a second filter that always agreed with the policy could never be
 * seen doing anything by a test (the lesson of T-031). A private note is therefore unreachable
 * by anyone but its author through any query, a colleague's or an agency owner's included.
 *
 * **Mutable, with no evidence semantics** — no checksum, no custody, no grant. Editing a note is
 * what a note is for. **Soft-deleted**, never removed.
 *
 * Audit entries name the fields that changed and the visibility, never the body: a note is
 * thinking about a person (`audit-logging`).
 */
@Injectable()
export class NotesService {
  private readonly access: AssignmentAccess;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {
    this.access = new AssignmentAccess(db, authz);
  }

  /** Own notes for the author; shared ones for the customer. Anyone else: 404. */
  async list(actor: Actor, assignmentId: string, req: RequestContext): Promise<NoteView[]> {
    const c = ctx('investigation_note.list', req, assignmentId);
    await this.access.requireReader(actor, assignmentId, c);
    const rows = await this.db
      .select()
      .from(investigationNotes)
      .where(
        and(
          eq(investigationNotes.assignmentId, assignmentId),
          isNull(investigationNotes.deletedAt),
        ),
      )
      .orderBy(asc(investigationNotes.createdAt), asc(investigationNotes.id));
    return rows.map(view);
  }

  async create(
    actor: Actor,
    assignmentId: string,
    dto: CreateNoteDto,
    req: RequestContext,
  ): Promise<NoteView> {
    const c = ctx('investigation_note.create', req, assignmentId);
    await this.access.requireWriter(actor, c);
    const body = requireText('body', dto.body);

    return this.db.transaction(async (tx) => {
      await this.access.holdLive(tx, actor, assignmentId, c);
      const [row] = await tx
        .insert(investigationNotes)
        .values({
          assignmentId,
          authorId: actor.userId,
          body,
          visibility: dto.visibility ?? 'PRIVATE',
        })
        .returning();
      await this.record(actor, c, 'investigation_note.created', row!.id, row!.visibility, tx);
      return view(row!);
    });
  }

  /**
   * Edits the body, shares or unshares. A change of visibility is its own audit entry — who
   * showed it to the customer, or took it back, and when — apart from any edit to the text.
   */
  async update(
    actor: Actor,
    assignmentId: string,
    noteId: string,
    dto: UpdateNoteDto,
    req: RequestContext,
  ): Promise<NoteView> {
    const c = ctx('investigation_note.update', req, noteId);
    await this.access.requireWriter(actor, c);
    const text = dto.body === undefined ? undefined : requireText('body', dto.body);

    return this.db.transaction(async (tx) => {
      const note = await this.hold(tx, actor, assignmentId, noteId, c);
      const body = text ?? note.body;
      const visibility = dto.visibility ?? note.visibility;
      const edited = body !== note.body;
      const reshared = visibility !== note.visibility;
      if (!edited && !reshared) return view(note);

      const [row] = await tx
        .update(investigationNotes)
        .set({ body, visibility, updatedAt: new Date() })
        .where(eq(investigationNotes.id, noteId))
        .returning();
      if (edited) await this.record(actor, c, 'investigation_note.updated', noteId, 'body', tx);
      if (reshared) {
        await this.record(
          actor,
          c,
          'investigation_note.visibility_changed',
          noteId,
          `${note.visibility} -> ${visibility}`,
          tx,
        );
      }
      return view(row!);
    });
  }

  /** Out of every view, and kept: retention is a policy a job enforces, not this. Final. */
  async remove(
    actor: Actor,
    assignmentId: string,
    noteId: string,
    req: RequestContext,
  ): Promise<void> {
    const c = ctx('investigation_note.delete', req, noteId);
    await this.access.requireWriter(actor, c);

    await this.db.transaction(async (tx) => {
      const note = await this.hold(tx, actor, assignmentId, noteId, c);
      await tx
        .update(investigationNotes)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(investigationNotes.id, noteId));
      await this.record(actor, c, 'investigation_note.deleted', noteId, note.visibility, tx);
    });
  }

  /**
   * A live, undeleted note of this assignment, for its investigator while the work is live. Only
   * the author's own rows are there to find (`author_works`), so anyone else's id is a 404.
   */
  private async hold(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    noteId: string,
    c: AuthzContext,
  ): Promise<NoteRow> {
    await this.access.holdLive(tx, actor, assignmentId, c);
    const [note] = await tx
      .select()
      .from(investigationNotes)
      .where(
        and(
          eq(investigationNotes.id, noteId),
          eq(investigationNotes.assignmentId, assignmentId),
          isNull(investigationNotes.deletedAt),
        ),
      )
      .for('update');
    return this.authz.visible(actor, note, c);
  }

  private async record(
    actor: Actor,
    c: AuthzContext,
    action: string,
    noteId: string,
    reason: string,
    tx: Tx,
  ): Promise<void> {
    await this.audit.record(
      {
        correlationId: c.correlationId,
        ipAddress: c.ipAddress,
        actorId: actor.userId,
        actorRole: 'INVESTIGATOR',
        action,
        resourceType: 'investigation_note',
        resourceId: noteId,
        reason,
      },
      tx,
    );
  }
}

const ctx = (action: string, req: RequestContext, resourceId?: string) =>
  authzContext('investigation_note', action, req, resourceId);

const view = (n: NoteRow): NoteView => ({
  id: n.id,
  assignmentId: n.assignmentId,
  authorId: n.authorId,
  body: n.body,
  visibility: n.visibility,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
});
