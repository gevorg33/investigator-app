import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { AuditService } from '../../common/audit/audit.service';
import { currentPlatformAccess } from '../../common/context/platform-context';
import type { RequestContext } from '../../common/http/request-context';
import type { Tx } from '../../database/database.module';
import type { LegalHoldResource } from './legal-hold.policy';
import type { RetentionRule } from './retention-rules';

/** A resource a row belongs to, and the column that names it. A hold on it keeps the row. */
export interface HeldBy {
  readonly type: LegalHoldResource;
  readonly column: AnyPgColumn;
}

export interface RetentionSweep {
  readonly rule: RetentionRule;
  readonly table: PgTable;
  /** The rows the rule removes now, before any hold is considered. */
  readonly due: SQL;
  /** Every resource a row belongs to. A row is kept if any of them is under a hold in force. */
  readonly heldBy: readonly [HeldBy, ...HeldBy[]];
}

export interface SweepResult {
  deleted: number;
  /** Rows that were due and stayed, because a hold covers them. */
  kept: number;
}

/**
 * The one way retention deletes a row (T-035). **Legal hold overrides retention**
 * (docs/compliance/retention.md): a row due for deletion that belongs to a resource under a hold in
 * force is kept, and the hold that kept it is reported — audited as `retention.kept`, with the rule
 * and the count — every time the rule runs, so the trail shows the hold doing its work.
 *
 * It runs in the transaction of the job that swept (T-204: `RetentionSweepHandler`, a system job
 * the runner has already taken into the audited system context), so the deletion, the report, the
 * audit and the job's own record commit together: what the log says was deleted was. **It refuses
 * to run outside platform access**: holds are invisible there, so a sweep that ran anyway would see
 * none and delete everything. `retention.static.spec.ts` holds that no other code deletes for
 * retention.
 */
@Injectable()
export class RetentionGuard {
  constructor(private readonly audit: AuditService) {}

  async sweep(tx: Tx, s: RetentionSweep, req: RequestContext): Promise<SweepResult> {
    if (currentPlatformAccess() === undefined) {
      throw new Error(
        `retention outside platform access: ${s.rule} would see no legal hold and keep nothing`,
      );
    }
    const holds = (await tx.execute(sql`
          SELECT h.id, count(*)::int AS n
            FROM ${s.table}
            JOIN legal_holds h ON h.released_at IS NULL AND (${sql.join(
              s.heldBy.map(
                (b) => sql`(h.resource_type = ${b.type} AND h.resource_id = ${b.column})`,
              ),
              sql` OR `,
            )})
           WHERE ${s.due}
           GROUP BY h.id
           ORDER BY h.id`)) as unknown as Array<{ id: string; n: number }>;

    const [gone] = (await tx.execute(sql`
          WITH gone AS (
            DELETE FROM ${s.table}
             WHERE ${s.due}
               AND ${sql.join(
                 s.heldBy.map(
                   (b) => sql`NOT EXISTS (
                     SELECT 1 FROM legal_holds h
                      WHERE h.released_at IS NULL
                        AND h.resource_type = ${b.type} AND h.resource_id = ${b.column})`,
                 ),
                 sql` AND `,
               )}
            RETURNING 1
          )
          SELECT count(*)::int AS n FROM gone`)) as unknown as Array<{ n: number }>;
    const deleted = gone!.n;

    const audited = {
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorRole: 'SYSTEM',
      staffScope: 'SYSTEM',
    };
    for (const hold of holds) {
      await this.audit.record(
        {
          ...audited,
          action: 'retention.kept',
          resourceType: 'legal_hold',
          resourceId: hold.id,
          reason: `${s.rule}: ${hold.n} due for deletion, kept under this hold`,
        },
        tx,
      );
    }
    if (deleted > 0) {
      await this.audit.record(
        {
          ...audited,
          action: 'retention.deleted',
          resourceType: 'retention_rule',
          resourceId: s.rule,
          reason: `${deleted} deleted`,
        },
        tx,
      );
    }

    // A row under two holds is counted under each in the report, and once here.
    const [due] = (await tx.execute(
      sql`SELECT count(*)::int AS n FROM ${s.table} WHERE ${s.due}`,
    )) as unknown as Array<{ n: number }>;
    return { deleted, kept: due!.n };
  }
}
