import { and, eq, or } from 'drizzle-orm';
import type { AuthzContext, AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import type { Db, Tx } from '../../database/database.module';
import { assignments, investigatorProfiles, type assignmentStatus } from '../../database/schema';

type AssignmentRow = typeof assignments.$inferSelect;
type AssignmentStatus = (typeof assignmentStatus.enumValues)[number];

/**
 * When notes and tasks can be written: while the work is live — the rule the owner set for
 * sources (2026-09-23, `SOURCES_WRITABLE`), applied to the rest of the investigator's workspace.
 * Before acceptance the work is not theirs; after completion or cancellation it is a record.
 * `assignment-access.spec.ts` keeps the two sets equal.
 */
export const WORKSPACE_WRITABLE: ReadonlySet<AssignmentStatus> = new Set([
  'ACCEPTED',
  'IN_PROGRESS',
  'REPORT_SUBMITTED',
]);

/**
 * The checks notes and tasks share (T-032) — the same ones sources make (T-031), so both kinds of
 * working record answer who-may-touch-it identically.
 */
export class AssignmentAccess {
  constructor(
    private readonly db: Db,
    private readonly authz: AuthzService,
  ) {}

  /** A reader: active, holding `investigations.read`, and a party to the assignment. */
  async requireReader(actor: Actor, assignmentId: string, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requirePermission(actor, 'investigations.read', c);
    const [row] = await this.db
      .select({ assignment: assignments })
      .from(assignments)
      .leftJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(
        and(
          eq(assignments.id, assignmentId),
          or(
            eq(assignments.customerId, actor.userId),
            eq(investigatorProfiles.userId, actor.userId),
          ),
        ),
      );
    // Neither party: the same 404 as an id that does not exist.
    await this.authz.visible(actor, row?.assignment, c);
  }

  /** A writer before any row is read: active, an investigator, holding `investigations.update`. */
  async requireWriter(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, 'investigations.update', c);
  }

  /**
   * The assignment, share-locked, if this actor is its investigator and the work is live. The lock
   * stops a note or task being written in the instant the assignment completes: the transition
   * takes the row for update, and waits for this to commit.
   */
  async holdLive(
    tx: Tx,
    actor: Actor,
    assignmentId: string,
    c: AuthzContext,
  ): Promise<AssignmentRow> {
    const [row] = await tx
      .select({ assignment: assignments })
      .from(assignments)
      .innerJoin(
        investigatorProfiles,
        eq(investigatorProfiles.id, assignments.investigatorProfileId),
      )
      .where(and(eq(assignments.id, assignmentId), eq(investigatorProfiles.userId, actor.userId)))
      .for('share', { of: assignments });
    const assignment = await this.authz.visible(actor, row?.assignment, c);
    await this.authz.stateAllows(actor, WORKSPACE_WRITABLE.has(assignment.status), c);
    return assignment;
  }
}

export const authzContext = (
  resourceType: 'investigation_note' | 'investigation_task',
  action: string,
  req: RequestContext,
  resourceId?: string,
): AuthzContext => ({
  action,
  resourceType,
  resourceId,
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

/**
 * The text as it will be stored, refused if nothing is left once trimmed. A DTO's length check
 * passes "   ", and the database's would then refuse it as a 500 (T-153); this says so as a field
 * error the form can put under the field.
 */
export function requireText(field: string, value: string): string {
  const text = value.trim();
  if (text.length === 0) {
    throw AppError.validation([
      { field, code: 'REQUIRED', messageKey: 'error.validation.investigation_workspace.blank' },
    ]);
  }
  return text;
}
