import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db, type Tx } from '../../database/database.module';
import { investigationTasks } from '../../database/schema';
import { AssignmentAccess, authzContext, requireText } from './assignment-access';
import type {
  CreateTaskDto,
  TransitionTaskDto,
  UpdateTaskDto,
} from './investigation-workspace.dto';
import { canMove } from './task-transitions';

type TaskRow = typeof investigationTasks.$inferSelect;

export interface TaskView {
  id: string;
  assignmentId: string;
  createdBy: string;
  title: string;
  description: string | null;
  status: TaskRow['status'];
  dueOn: string | null;
  position: number;
  visibility: TaskRow['visibility'];
  createdAt: string;
  updatedAt: string;
}

/** The fields an edit may touch — status is not among them. */
const EDITABLE = ['title', 'description', 'dueOn', 'position', 'visibility'] as const;

/**
 * The work plan inside an assignment (plan.md §8, T-032).
 *
 * Who reads which tasks is row-level security's alone, exactly as for notes: the creator their
 * own, the customer's workspace the shared ones. A task's status moves only through `transition`,
 * along the edges in `task-transitions.ts`, which the database holds as well — never through an
 * edit, whose shape has no status to set.
 *
 * Audit entries name the fields that changed, the visibility and the move, never a title or a
 * description: "interview the neighbour at 12 Example St" names a person.
 */
@Injectable()
export class TasksService {
  private readonly access: AssignmentAccess;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {
    this.access = new AssignmentAccess(db, authz);
  }

  /** In plan order. Own tasks for the creator; shared ones for the customer. Anyone else: 404. */
  async list(actor: Actor, assignmentId: string, req: RequestContext): Promise<TaskView[]> {
    const c = ctx('investigation_task.list', req, assignmentId);
    await this.access.requireReader(actor, assignmentId, c);
    const rows = await this.db
      .select()
      .from(investigationTasks)
      .where(
        and(
          eq(investigationTasks.assignmentId, assignmentId),
          isNull(investigationTasks.deletedAt),
        ),
      )
      .orderBy(
        asc(investigationTasks.position),
        asc(investigationTasks.createdAt),
        asc(investigationTasks.id),
      );
    return rows.map(view);
  }

  async create(
    actor: Actor,
    assignmentId: string,
    dto: CreateTaskDto,
    req: RequestContext,
  ): Promise<TaskView> {
    const c = ctx('investigation_task.create', req, assignmentId);
    await this.access.requireWriter(actor, c);
    const title = requireText('title', dto.title);

    return this.db.transaction(async (tx) => {
      await this.access.holdLive(tx, actor, assignmentId, c);
      // At the end of the creator's list unless told otherwise. Their own rows are all they see.
      const [last] = await tx
        .select({ next: sql<number>`coalesce(max(${investigationTasks.position}) + 1, 0)::int` })
        .from(investigationTasks)
        .where(
          and(
            eq(investigationTasks.assignmentId, assignmentId),
            isNull(investigationTasks.deletedAt),
          ),
        );
      const [row] = await tx
        .insert(investigationTasks)
        .values({
          assignmentId,
          createdBy: actor.userId,
          title,
          description: dto.description ?? null,
          dueOn: dto.dueOn ?? null,
          position: dto.position ?? last!.next,
          visibility: dto.visibility ?? 'PRIVATE',
        })
        .returning();
      await this.record(actor, c, 'investigation_task.created', row!.id, row!.visibility, tx);
      return view(row!);
    });
  }

  /** Edits a task's own fields, and shares or unshares it — its own audit entry, as for a note. */
  async update(
    actor: Actor,
    assignmentId: string,
    taskId: string,
    dto: UpdateTaskDto,
    req: RequestContext,
  ): Promise<TaskView> {
    const c = ctx('investigation_task.update', req, taskId);
    await this.access.requireWriter(actor, c);
    const title = dto.title === undefined ? undefined : requireText('title', dto.title);

    return this.db.transaction(async (tx) => {
      const task = await this.hold(tx, actor, assignmentId, taskId, c);
      const next = {
        title: title ?? task.title,
        description: dto.description === undefined ? task.description : dto.description,
        dueOn: dto.dueOn === undefined ? task.dueOn : dto.dueOn,
        position: dto.position ?? task.position,
        visibility: dto.visibility ?? task.visibility,
      };
      const changed = EDITABLE.filter((k) => next[k] !== task[k]);
      if (changed.length === 0) return view(task);

      const [row] = await tx
        .update(investigationTasks)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(investigationTasks.id, taskId))
        .returning();
      const edits = changed.filter((k) => k !== 'visibility');
      if (edits.length > 0) {
        await this.record(actor, c, 'investigation_task.updated', taskId, edits.join(', '), tx);
      }
      if (changed.includes('visibility')) {
        await this.record(
          actor,
          c,
          'investigation_task.visibility_changed',
          taskId,
          `${task.visibility} -> ${next.visibility}`,
          tx,
        );
      }
      return view(row!);
    });
  }

  /**
   * Moves a task along one edge of `task-transitions.ts`. A move that is not an edge is refused
   * with 403 and audited, as an illegal assignment move is; asking for where it already is, too.
   */
  async transition(
    actor: Actor,
    assignmentId: string,
    taskId: string,
    dto: TransitionTaskDto,
    req: RequestContext,
  ): Promise<TaskView> {
    const c = ctx('investigation_task.transition', req, taskId);
    await this.access.requireWriter(actor, c);

    return this.db.transaction(async (tx) => {
      const task = await this.hold(tx, actor, assignmentId, taskId, c);
      await this.authz.stateAllows(actor, canMove(task.status, dto.to), c);
      const [row] = await tx
        .update(investigationTasks)
        .set({ status: dto.to, updatedAt: new Date() })
        .where(eq(investigationTasks.id, taskId))
        .returning();
      await this.record(
        actor,
        c,
        'investigation_task.moved',
        taskId,
        `${task.status} -> ${dto.to}`,
        tx,
      );
      return view(row!);
    });
  }

  /** Out of every view, and kept. Final. */
  async remove(
    actor: Actor,
    assignmentId: string,
    taskId: string,
    req: RequestContext,
  ): Promise<void> {
    const c = ctx('investigation_task.delete', req, taskId);
    await this.access.requireWriter(actor, c);

    await this.db.transaction(async (tx) => {
      const task = await this.hold(tx, actor, assignmentId, taskId, c);
      await tx
        .update(investigationTasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(investigationTasks.id, taskId));
      await this.record(actor, c, 'investigation_task.deleted', taskId, task.status, tx);
    });
  }

  /** A live, undeleted task of this assignment. Only the creator's own are there to find. */
  private async hold(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    taskId: string,
    c: AuthzContext,
  ): Promise<TaskRow> {
    await this.access.holdLive(tx, actor, assignmentId, c);
    const [task] = await tx
      .select()
      .from(investigationTasks)
      .where(
        and(
          eq(investigationTasks.id, taskId),
          eq(investigationTasks.assignmentId, assignmentId),
          isNull(investigationTasks.deletedAt),
        ),
      )
      .for('update');
    return this.authz.visible(actor, task, c);
  }

  private async record(
    actor: Actor,
    c: AuthzContext,
    action: string,
    taskId: string,
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
        resourceType: 'investigation_task',
        resourceId: taskId,
        reason,
      },
      tx,
    );
  }
}

const ctx = (action: string, req: RequestContext, resourceId?: string) =>
  authzContext('investigation_task', action, req, resourceId);

const view = (t: TaskRow): TaskView => ({
  id: t.id,
  assignmentId: t.assignmentId,
  createdBy: t.createdBy,
  title: t.title,
  description: t.description,
  status: t.status,
  dueOn: t.dueOn,
  position: t.position,
  visibility: t.visibility,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
