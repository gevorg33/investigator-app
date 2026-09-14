import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../../database/database.module';
import { auditLogs } from '../../database/schema';

export interface AuditEvent {
  correlationId?: string | undefined;
  actorId?: string | undefined;
  actorRole?: string | undefined;
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

  async record(e: AuditEvent): Promise<void> {
    await this.db.insert(auditLogs).values({
      correlationId: e.correlationId ?? null,
      actorId: e.actorId ?? null,
      actorRole: e.actorRole ?? null,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ?? null,
      reason: e.reason ?? null,
      ipAddress: e.ipAddress ?? null,
      userAgent: e.userAgent ?? null,
    });
  }
}
