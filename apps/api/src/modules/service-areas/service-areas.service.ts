import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { TenantPermission } from '../../common/authz/permissions';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { serviceAreas } from '../../database/schema';
import type { LonLat } from '../../database/schema/types';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import type { CreateServiceAreaDto } from './service-areas.dto';
import {
  coarsen,
  DEFAULT_RESULT_LIMIT,
  MAX_AREAS_PER_PROFILE,
  MAX_RESULT_LIMIT,
  MAX_SEARCH_RADIUS_M,
  toReportedKm,
} from './service-areas.policy';

/** The owner's view of an area. Never returned for anyone else's areas. */
export interface OwnServiceArea {
  id: string;
  kind: 'RADIUS' | 'POLYGON';
  label: string;
  /** Where the area is, as text — what the country/city filters in discovery match on. */
  countryCode: string | null;
  region: string | null;
  city: string | null;
  centre: LonLat | null;
  radiusKm: number | null;
  boundary: LonLat[] | null;
  createdAt: Date;
}

/**
 * One investigator an area covers. An id and a rounded distance — no geometry, no centre, no
 * coordinates of any kind leave this service for somebody else's areas.
 */
export interface Coverage {
  profileId: string;
  distanceKm: number;
}

/** Constraint name → the reason reported back, for shape rules the database enforces. */
const SHAPE_VIOLATIONS: Record<string, string> = {
  service_areas_min_area: 'TOO_SMALL',
  service_areas_area_valid: 'INVALID_SHAPE',
  service_areas_area_simple: 'TOO_COMPLEX',
};

/**
 * The coverage query, exported so tests can EXPLAIN exactly what production runs.
 *
 * `ST_DWithin` filters, with a constant distance, so the GIST index on `area` is usable.
 * `ST_Distance` only orders. `WHERE ST_Distance(...) < x` is the classic mistake: it cannot
 * use the index and scans every area.
 *
 * GROUP BY collapses an investigator's several areas into one result at the nearest
 * distance — otherwise overlapping areas would list the same person repeatedly.
 */
export function coverageQuery(point: LonLat, searchRadiusM: number, limit: number): SQL {
  const at = sql`ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography`;
  return sql`
    SELECT sa.profile_id AS "profileId", min(ST_Distance(sa.area, ${at})) AS "distanceM"
    FROM service_areas sa
    JOIN investigator_profiles ip ON ip.id = sa.profile_id
    WHERE ip.visibility = 'PUBLISHED'
      AND ip.verification_status = 'VERIFIED'
      AND ip.accepting_work = true
      AND ST_DWithin(sa.area, ${at}, ${searchRadiusM})
    GROUP BY sa.profile_id
    ORDER BY "distanceM" ASC, sa.profile_id ASC
    LIMIT ${limit}`;
}

@Injectable()
export class ServiceAreasService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly profiles: OwnInvestigatorProfileRepository,
  ) {}

  async listMine(actor: Actor, req: RequestContext): Promise<OwnServiceArea[]> {
    const profileId = await this.myProfileId(
      actor,
      this.ctx('service_area.list', req),
      'investigators.read',
    );
    const rows = await this.db
      .select()
      .from(serviceAreas)
      .where(eq(serviceAreas.profileId, profileId))
      .orderBy(serviceAreas.createdAt);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      countryCode: r.countryCode,
      region: r.region,
      city: r.city,
      centre: r.centre,
      radiusKm: r.radiusM === null ? null : r.radiusM / 1000,
      // The outer ring without its closing point: the shape as the investigator drew it.
      boundary:
        r.kind === 'POLYGON'
          ? r.area.rings[0]!.slice(0, -1).map(([lon, lat]) => ({ lon, lat }))
          : null,
      createdAt: r.createdAt,
    }));
  }

  async createMine(
    actor: Actor,
    dto: CreateServiceAreaDto,
    req: RequestContext,
  ): Promise<OwnServiceArea> {
    const c = this.ctx('service_area.create', req);
    const profileId = await this.myProfileId(actor, c, 'investigators.update');

    // COUNT with no GROUP BY always returns exactly one row.
    const [existing] = await this.db
      .select({ n: count() })
      .from(serviceAreas)
      .where(eq(serviceAreas.profileId, profileId));
    if (existing!.n >= MAX_AREAS_PER_PROFILE) {
      throw AppError.validation([
        {
          field: 'kind',
          code: 'LIMIT_REACHED',
          messageKey: 'error.validation.service_area.limit_reached',
        },
      ]);
    }

    const values =
      dto.kind === 'RADIUS'
        ? this.radiusValues(dto)
        : { kind: 'POLYGON' as const, area: this.polygon(dto) };

    let row: { id: string } | undefined;
    try {
      [row] = await this.db
        .insert(serviceAreas)
        .values({
          profileId,
          label: dto.label,
          countryCode: dto.countryCode ?? null,
          region: dto.region ?? null,
          city: dto.city ?? null,
          ...values,
        })
        .returning({ id: serviceAreas.id });
    } catch (e) {
      const cause = (e as { cause?: { code?: string; constraint_name?: string } }).cause;
      // A check violation always names its constraint; anything unmapped is rethrown as it is.
      const reason =
        cause?.code === '23514' ? SHAPE_VIOLATIONS[String(cause.constraint_name)] : undefined;
      if (!reason) throw e;
      throw AppError.validation([
        { field: 'boundary', code: reason, messageKey: 'error.validation.service_area.shape' },
      ]);
    }
    // RETURNING on a single-row insert always yields the row; an invariant, not a case.
    if (!row) throw new AppError('INTERNAL_ERROR');

    await this.record(actor, req, 'service_area.created', row.id, values.kind);
    const created = (await this.listMine(actor, req)).find((a) => a.id === row.id);
    return created!;
  }

  async deleteMine(actor: Actor, id: string, req: RequestContext): Promise<void> {
    const c = this.ctx('service_area.delete', req, id);
    const profileId = await this.myProfileId(actor, c, 'investigators.update');
    // The profile id in the predicate is the ownership check: another investigator's area id
    // matches nothing, and the answer is the same 404 as an id that never existed.
    const [deleted] = await this.db
      .delete(serviceAreas)
      .where(and(eq(serviceAreas.id, id), eq(serviceAreas.profileId, profileId)))
      .returning({ id: serviceAreas.id });
    await this.authz.visible(actor, deleted, c);
    await this.record(actor, req, 'service_area.deleted', id, 'owner');
  }

  /**
   * Published investigators accepting work whose areas cover a point, nearest first, each once.
   *
   * Takes no actor: it answers a question about investigators' public storefronts, and returns
   * nothing that is not already public except a rounded distance.
   *
   * Verification is now part of the filter, as this comment promised it would be once the
   * column existed. It belongs here rather than only in discovery: "an unverified investigator
   * never appears, by any path" (T-011) is only true if every path enforces it, and this is a
   * path — one that discovery, the assistant's tools and anything else can reach directly.
   */
  async findCoverage(
    point: LonLat,
    options: { searchRadiusM?: number; limit?: number } = {},
  ): Promise<Coverage[]> {
    const searchRadiusM = options.searchRadiusM ?? 0;
    const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
    const bad =
      !(Math.abs(point.lon) <= 180) || !(Math.abs(point.lat) <= 90)
        ? 'point'
        : !(searchRadiusM >= 0 && searchRadiusM <= MAX_SEARCH_RADIUS_M)
          ? 'searchRadiusM'
          : !(Number.isInteger(limit) && limit >= 1 && limit <= MAX_RESULT_LIMIT)
            ? 'limit'
            : undefined;
    if (bad) {
      throw AppError.validation([
        { field: bad, code: 'OUT_OF_RANGE', messageKey: 'error.validation.coverage.range' },
      ]);
    }

    const rows = (await this.db.execute(
      coverageQuery(point, searchRadiusM, limit),
    )) as unknown as Array<{
      profileId: string;
      distanceM: number;
    }>;
    return rows.map((r) => ({
      profileId: r.profileId,
      distanceKm: toReportedKm(Number(r.distanceM)),
    }));
  }

  private radiusValues(dto: CreateServiceAreaDto) {
    // The DTO requires both for RADIUS; asserted here rather than re-checked.
    const centre = { lon: coarsen(dto.centre!.lon), lat: coarsen(dto.centre!.lat) };
    const radiusM = dto.radiusKm! * 1000;
    return {
      kind: 'RADIUS' as const,
      centre,
      radiusM,
      // Buffered in the database, from the coarsened centre — never from what the client sent.
      area: sql`ST_Buffer(ST_SetSRID(ST_MakePoint(${centre.lon}, ${centre.lat}), 4326)::geography, ${radiusM})`,
    };
  }

  private polygon(dto: CreateServiceAreaDto) {
    const ring: Array<[number, number]> = dto.boundary!.map((p) => [p.lon, p.lat]);
    const [first] = ring;
    const last = ring[ring.length - 1]!;
    // Close the ring if the client did not; PostGIS requires the first and last points equal.
    if (first![0] !== last[0] || first![1] !== last[1]) ring.push([first![0], first![1]]);
    return { rings: [ring] };
  }

  /**
   * The caller's own investigator profile. `permission` is what this particular action needs in
   * the workspace it is running in — reading an area and changing one are not the same right.
   */
  private async myProfileId(
    actor: Actor,
    c: AuthzContext,
    permission: TenantPermission,
  ): Promise<string> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
    await this.authz.requirePermission(actor, permission, c);
    const profile = await this.authz.visible(actor, await this.profiles.findMine(actor), c);
    return profile.id;
  }

  private async record(
    actor: Actor,
    req: RequestContext,
    action: string,
    resourceId: string,
    reason: string,
  ) {
    await this.audit.record({
      correlationId: req.correlationId,
      ipAddress: req.ip,
      userAgent: req.userAgent,
      actorId: actor.userId,
      action,
      resourceType: 'service_area',
      resourceId,
      reason,
    });
  }

  private ctx(action: string, req: RequestContext, resourceId?: string): AuthzContext {
    return {
      action,
      resourceType: 'service_area',
      resourceId,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
  }
}
