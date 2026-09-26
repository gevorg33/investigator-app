import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { AppError, type FieldIssue } from '../../../common/errors/app-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db, type Tx } from '../../../database/database.module';
import { mediaAssets, tenantProfiles, tenants } from '../../../database/schema';
import { MediaService, type DeliveryUrl } from '../../media/media.service';

/** A logo or cover as the agency sees it: which file, and a link once it can be shown. */
export interface OwnImage {
  mediaId: string;
  /** Null until the file is ready and scanned clean — then this is what customers see too. */
  link: DeliveryUrl | null;
}

/** The profile as the agency's own members see it, published or not. */
export interface OwnAgencyProfile {
  /** The name customers see: the display name if set, the registered name otherwise. */
  name: string;
  displayName: string | null;
  headline: string | null;
  about: string | null;
  logo: OwnImage | null;
  cover: OwnImage | null;
  publishedAt: Date | null;
  /** 0 for a profile never saved. */
  version: number;
  /** What stands between this profile and publishing it. Empty when it can be published. */
  missing: Array<'agency_setup' | 'headline'>;
}

/**
 * An agency as anyone signed in sees it once its profile is published (T-084): these fields and
 * nothing else — no settings, no business email, no members, no customers, no money.
 */
export interface PublicAgencyProfile {
  id: string;
  name: string;
  headline: string;
  about: string | null;
  countryCode: string | null;
  logo: DeliveryUrl | null;
  cover: DeliveryUrl | null;
}

export interface ProfileChanges {
  version: number;
  displayName?: string | null;
  headline?: string | null;
  about?: string | null;
  logoMediaId?: string | null;
  coverMediaId?: string | null;
}

type ProfileRow = typeof tenantProfiles.$inferSelect;

/** The workspace the request acts in — from the context, never from code (tenancy.md §6). */
const THIS_WORKSPACE = sql`app_current_tenant()`;

/** Text as stored: trimmed, and blank is no text. */
const clean = (value: string | null | undefined): string | null | undefined =>
  value === undefined || value === null ? value : value.trim() === '' ? null : value.trim();

/**
 * An agency's public profile (T-084, tenancy.md §12).
 *
 * Read by its members with `company.read`, changed and published with `company.update` (OWNER and
 * ADMIN), in an agency workspace only. Once published, anyone signed in reads the projection —
 * and only the projection — through `readPublished`; a draft, and a draft's images, are invisible
 * outside the agency, which the database enforces as well (migration 0024).
 */
@Injectable()
export class AgencyProfileService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly media: MediaService,
  ) {}

  async readOwn(actor: Actor, req: RequestContext): Promise<OwnAgencyProfile> {
    await this.require(actor, 'company.read', this.ctx('agency.profile.read', req));
    const [agency, row] = await Promise.all([this.agency(this.db), this.row(this.db)]);
    return this.own(agency, row);
  }

  /**
   * Changes the profile. Absent fields are left alone and null clears one. `version` is the one
   * read — 0 for a profile never saved. A logo or cover must be one of this agency's own uploads
   * in the right category, and uploaded; its scan may still be pending.
   */
  async update(
    actor: Actor,
    changes: ProfileChanges,
    req: RequestContext,
  ): Promise<OwnAgencyProfile> {
    const c = this.ctx('agency.profile.update', req);
    await this.require(actor, 'company.update', c);

    const saved = await this.db.transaction(async (tx) => {
      const row = await this.row(tx, true);
      if ((row?.version ?? 0) !== changes.version) throw AppError.stateConflict();
      // A published profile keeps its headline (tenant_profiles_published_has_headline): clearing
      // it would publish a profile that says nothing. Unpublish first.
      if (row?.publishedAt && changes.headline !== undefined && clean(changes.headline) === null) {
        throw AppError.validation([
          { field: 'headline', code: 'REQUIRED', messageKey: 'error.validation.agency_profile.headline' },
        ]);
      }
      this.requireLengths(changes);
      await this.requireImages(tx, changes);

      const patch = {
        ...(changes.displayName !== undefined && { displayName: clean(changes.displayName) }),
        ...(changes.headline !== undefined && { headline: clean(changes.headline) }),
        ...(changes.about !== undefined && { about: clean(changes.about) }),
        ...(changes.logoMediaId !== undefined && { logoMediaId: changes.logoMediaId }),
        ...(changes.coverMediaId !== undefined && { coverMediaId: changes.coverMediaId }),
      };
      const written =
        row === undefined
          ? await tx.insert(tenantProfiles).values(patch).onConflictDoNothing().returning()
          : await tx
              .update(tenantProfiles)
              .set({ ...patch, version: row.version + 1, updatedAt: new Date() })
              .where(
                and(
                  eq(tenantProfiles.tenantId, THIS_WORKSPACE),
                  eq(tenantProfiles.version, row.version),
                ),
              )
              .returning();
      if (written[0] === undefined) throw AppError.stateConflict();
      return written[0];
    });

    await this.record(actor, req, 'agency.profile.updated');
    return this.own(await this.agency(this.db), saved);
  }

  /**
   * Makes the profile visible to everyone signed in. It needs a finished agency — one that is
   * ACTIVE — and a headline, so that what customers find says what the agency does.
   */
  async publish(actor: Actor, version: number, req: RequestContext): Promise<OwnAgencyProfile> {
    return this.setPublished(actor, version, true, req);
  }

  /** Takes the profile back to a draft. Its text and images stay, for the agency alone. */
  async unpublish(actor: Actor, version: number, req: RequestContext): Promise<OwnAgencyProfile> {
    return this.setPublished(actor, version, false, req);
  }

  /**
   * A published agency's profile, by the agency's id. Not published, not an agency, not ACTIVE,
   * or not there at all: the same 404, so the answer says nothing about which.
   */
  async readPublished(
    actor: Actor,
    agencyId: string,
    req: RequestContext,
  ): Promise<PublicAgencyProfile> {
    const c = this.ctx('agency.profile.read_public', req, agencyId);
    await this.authz.requireActive(actor, c);
    const [found] = await this.db
      .select({
        id: tenants.id,
        registeredName: tenants.name,
        countryCode: tenants.countryCode,
        displayName: tenantProfiles.displayName,
        headline: tenantProfiles.headline,
        about: tenantProfiles.about,
        logoMediaId: tenantProfiles.logoMediaId,
        coverMediaId: tenantProfiles.coverMediaId,
      })
      .from(tenantProfiles)
      .innerJoin(tenants, eq(tenants.id, tenantProfiles.tenantId))
      .where(
        and(
          eq(tenantProfiles.tenantId, agencyId),
          isNotNull(tenantProfiles.publishedAt),
          eq(tenants.kind, 'AGENCY'),
          eq(tenants.status, 'ACTIVE'),
        ),
      );
    const row = await this.authz.visible(actor, found, c);
    const links = await this.media.profileImageLinks(
      [row.logoMediaId, row.coverMediaId].filter((id): id is string => id !== null),
    );
    return {
      id: row.id,
      name: row.displayName ?? row.registeredName!,
      // A published profile always has one: tenant_profiles_published_has_headline.
      headline: row.headline!,
      about: row.about,
      countryCode: row.countryCode,
      logo: row.logoMediaId === null ? null : (links.get(row.logoMediaId) ?? null),
      cover: row.coverMediaId === null ? null : (links.get(row.coverMediaId) ?? null),
    };
  }

  private async setPublished(
    actor: Actor,
    version: number,
    published: boolean,
    req: RequestContext,
  ): Promise<OwnAgencyProfile> {
    const action = published ? 'agency.profile.publish' : 'agency.profile.unpublish';
    const c = this.ctx(action, req);
    await this.require(actor, 'company.update', c);

    const { agency, saved } = await this.db.transaction(async (tx) => {
      const [agency, row] = await Promise.all([this.agency(tx), this.row(tx, true)]);
      if ((row?.version ?? 0) !== version) throw AppError.stateConflict();
      if (published) {
        const missing = this.missing(agency, row);
        if (missing.length > 0) {
          throw AppError.validation(
            missing.map((field): FieldIssue => ({
              field,
              code: 'REQUIRED',
              messageKey: `error.validation.agency_profile.${field}`,
            })),
          );
        }
      }
      // A profile with a headline exists, so publishing always has a row to update; unpublishing
      // one never saved is a state that allows nothing.
      await this.authz.stateAllows(actor, row !== undefined, c);
      const [saved] = await tx
        .update(tenantProfiles)
        .set({
          publishedAt: published ? (row!.publishedAt ?? new Date()) : null,
          version: row!.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantProfiles.tenantId, THIS_WORKSPACE),
            eq(tenantProfiles.version, row!.version),
          ),
        )
        .returning();
      // The row is locked and its version checked in this transaction: the update cannot miss.
      return { agency, saved: saved! };
    });

    await this.record(
      actor,
      req,
      published ? 'agency.profile.published' : 'agency.profile.unpublished',
    );
    return this.own(agency, saved);
  }

  /** Lengths the database holds too (tenant_profiles_text_lengths), said as field errors first. */
  private requireLengths(changes: ProfileChanges): void {
    const issues = (
      [
        ['displayName', 2, 120],
        ['headline', 1, 160],
        ['about', 1, 3000],
      ] as const
    ).flatMap(([field, min, max]): FieldIssue[] => {
      const value = clean(changes[field]);
      return typeof value === 'string' && (value.length < min || value.length > max)
        ? [{ field, code: 'LENGTH', messageKey: `error.validation.agency_profile.${field}_length` }]
        : [];
    });
    if (issues.length > 0) throw AppError.validation(issues);
  }

  /** A logo or cover named in a change must be this agency's own file, of the right kind, uploaded. */
  private async requireImages(tx: Tx, changes: ProfileChanges): Promise<void> {
    const wanted = [
      { field: 'logoMediaId', id: changes.logoMediaId, category: 'AGENCY_LOGO' as const },
      { field: 'coverMediaId', id: changes.coverMediaId, category: 'AGENCY_COVER' as const },
    ].filter((w): w is typeof w & { id: string } => typeof w.id === 'string');
    if (wanted.length === 0) return;
    const usable = await tx
      .select({ id: mediaAssets.id, category: mediaAssets.category })
      .from(mediaAssets)
      .where(
        and(
          inArray(
            mediaAssets.id,
            wanted.map((w) => w.id),
          ),
          eq(mediaAssets.tenantId, THIS_WORKSPACE),
          eq(mediaAssets.uploadStatus, 'READY'),
          isNull(mediaAssets.deletedAt),
        ),
      );
    const issues = wanted
      .filter((w) => !usable.some((u) => u.id === w.id && u.category === w.category))
      .map((w): FieldIssue => ({
        field: w.field,
        code: 'NOT_USABLE',
        messageKey: 'error.validation.agency_profile.image',
      }));
    if (issues.length > 0) throw AppError.validation(issues);
  }

  private async own(agency: AgencyRow, row: ProfileRow | undefined): Promise<OwnAgencyProfile> {
    const logoId = row?.logoMediaId ?? null;
    const coverId = row?.coverMediaId ?? null;
    const links = await this.media.profileImageLinks(
      [logoId, coverId].filter((id): id is string => id !== null),
    );
    const image = (id: string | null): OwnImage | null =>
      id === null ? null : { mediaId: id, link: links.get(id) ?? null };
    return {
      name: row?.displayName ?? agency.name,
      displayName: row?.displayName ?? null,
      headline: row?.headline ?? null,
      about: row?.about ?? null,
      logo: image(logoId),
      cover: image(coverId),
      publishedAt: row?.publishedAt ?? null,
      version: row?.version ?? 0,
      missing: this.missing(agency, row),
    };
  }

  private missing(agency: AgencyRow, row: ProfileRow | undefined): OwnAgencyProfile['missing'] {
    return [
      ...(agency.status === 'ACTIVE' ? [] : (['agency_setup'] as const)),
      ...(row?.headline ? [] : (['headline'] as const)),
    ];
  }

  /** This agency's own row: its registered name and whether it is finished. */
  private async agency(db: Db | Tx): Promise<AgencyRow> {
    const [row] = await db
      .select({ name: tenants.name, status: tenants.status })
      .from(tenants)
      .where(eq(tenants.id, THIS_WORKSPACE));
    // The agency workspace was required already; its own row is always visible to its members.
    return { name: row!.name!, status: row!.status };
  }

  private async row(db: Db | Tx, lock = false): Promise<ProfileRow | undefined> {
    const query = db
      .select()
      .from(tenantProfiles)
      .where(eq(tenantProfiles.tenantId, THIS_WORKSPACE));
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  private async require(
    actor: Actor,
    permission: 'company.read' | 'company.update',
    c: AuthzContext,
  ): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireAgencyWorkspace(actor, c);
    await this.authz.requirePermission(actor, permission, c);
  }

  private async record(actor: Actor, req: RequestContext, action: string): Promise<void> {
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action,
      resourceType: 'tenant_profile',
    });
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'tenant_profile',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}

interface AgencyRow {
  name: string;
  status: (typeof tenants.$inferSelect)['status'];
}
