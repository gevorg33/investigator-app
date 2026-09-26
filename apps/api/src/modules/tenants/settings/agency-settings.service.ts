import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { AppError } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db } from '../../../database/database.module';
import { tenantSettings } from '../../../database/schema';
import { applyPatch, DEFAULTS, derived, SETTINGS_SECTIONS, type SettingsSection } from './sections';

/** One section as the workspace sees it. `version` 0 is a section never saved: its defaults. */
export interface SectionView {
  version: number;
  values: object;
  /** What follows from the values without being stored — for branding, the text colours. */
  derived: Record<string, string | null>;
}

export type SettingsView = Record<SettingsSection, SectionView>;

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

/**
 * An agency's settings (T-084, tenancy.md §12): typed sections, each defaulted, so nothing has to
 * be configured to use the product. Read with `settings.read`, changed with `settings.update`
 * (OWNER and ADMIN; MANAGER reads), in an agency workspace only.
 *
 * A save names the version it read. Two admins changing branding at once cannot silently
 * overwrite each other: the second is refused and re-reads.
 */
@Injectable()
export class AgencySettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  async read(actor: Actor, req: RequestContext): Promise<SettingsView> {
    await this.require(actor, 'settings.read', this.ctx('agency.settings.read', req));
    const rows = await this.db
      .select()
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, THIS_WORKSPACE));
    const saved = new Map(rows.map((r) => [r.section, r]));
    return Object.fromEntries(
      SETTINGS_SECTIONS.map((section) => {
        const row = saved.get(section);
        return [section, this.view(section, row?.version ?? 0, row?.value)];
      }),
    ) as SettingsView;
  }

  /**
   * Changes some of one section's values. `version` is the one read — 0 for a section never saved.
   * Unknown keys, malformed values and colours that fail contrast are refused, all at once.
   */
  async update(
    actor: Actor,
    section: SettingsSection,
    input: { version: number; values: Readonly<Record<string, unknown>> },
    req: RequestContext,
  ): Promise<SectionView> {
    const c = this.ctx('agency.settings.update', req, section);
    await this.require(actor, 'settings.update', c);

    const saved = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(tenantSettings)
        .where(
          and(eq(tenantSettings.tenantId, THIS_WORKSPACE), eq(tenantSettings.section, section)),
        )
        .for('update');
      // Read under the lock, so a concurrent first save of the same section waits and then
      // conflicts rather than inserting a second row (the primary key would refuse it anyway).
      if ((row?.version ?? 0) !== input.version) throw AppError.stateConflict();

      const result = applyPatch(
        section,
        { ...DEFAULTS[section], ...(row?.value ?? {}) },
        input.values,
      );
      if ('issues' in result) throw AppError.validation(result.issues);

      const values = { ...result.values };
      const written =
        row === undefined
          ? await tx
              .insert(tenantSettings)
              .values({ section, value: values, updatedBy: actor.userId })
              .onConflictDoNothing()
              .returning()
          : await tx
              .update(tenantSettings)
              .set({
                value: values,
                version: row.version + 1,
                updatedBy: actor.userId,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(tenantSettings.tenantId, THIS_WORKSPACE),
                  eq(tenantSettings.section, section),
                  eq(tenantSettings.version, row.version),
                ),
              )
              .returning();
      return written[0];
    });
    // Nothing written: a first save that lost the race to another first save of the section.
    if (saved === undefined) throw AppError.stateConflict();

    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action: 'agency.settings.updated',
      resourceType: 'tenant_settings',
      reason: section,
    });
    return this.view(section, saved.version, saved.value);
  }

  private view(section: SettingsSection, version: number, stored: unknown): SectionView {
    // Stored values over defaults: a setting added after a section was saved reads as its default.
    const values = { ...DEFAULTS[section], ...((stored as object | undefined) ?? {}) };
    return { version, values, derived: derived(section, values) };
  }

  private async require(
    actor: Actor,
    permission: 'settings.read' | 'settings.update',
    c: AuthzContext,
  ): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireAgencyWorkspace(actor, c);
    await this.authz.requirePermission(actor, permission, c);
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'tenant_settings',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}
