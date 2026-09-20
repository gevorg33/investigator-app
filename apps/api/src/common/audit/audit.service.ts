import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db, type Tx } from '../../database/database.module';
import { auditLogs } from '../../database/schema';

export interface AuditEvent {
  correlationId?: string | undefined;
  actorId?: string | undefined;
  actorRole?: string | undefined;
  /** For a staff action, the one area it belongs to — a moderator is not a payments reviewer. */
  staffScope?: string | undefined;
  action: string;
  resourceType: string;
  resourceId?: string | undefined;
  reason?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Append-only by grant (migration 0000). The application role holds no UPDATE or
 * DELETE on this table, so a bug cannot rewrite history even if it tried.
 *
 * References, never content: ids and actions, never tokens, evidence bytes or
 * message bodies (audit-logging).
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Pass `tx` when the audited change is written in a transaction. The entry then commits or
   * rolls back with the change, so the log never records something that did not happen — and
   * never misses something that did.
   */
  async record(e: AuditEvent, tx?: Tx): Promise<void> {
    await (tx ?? this.db).insert(auditLogs).values({
      correlationId: e.correlationId ?? null,
      actorId: e.actorId ?? null,
      actorRole: e.actorRole ?? null,
      staffScope: e.staffScope ?? null,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      reason: e.reason ?? null,
      ipAddress: e.ipAddress ?? null,
      userAgent: e.userAgent ?? null,
    });
  }
}
