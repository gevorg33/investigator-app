import { Inject, Injectable } from '@nestjs/common';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import {
  investigatorAvailability,
  investigatorLanguages,
  investigatorProfiles,
  investigatorSpecialties,
  users,
} from '../../database/schema';
import {
  toPublicInvestigatorProfile,
  type PublicInvestigatorProfile,
} from '../profiles/profile.projection';
import { toReportedKm } from '../service-areas/service-areas.policy';
import type { SearchInvestigatorsDto } from './search.dto';
import { clampLimit, decodeCursor, encodeCursor } from './search.policy';
import { taxonomyClosure } from './taxonomy-closure';

/**
 * Why this investigator is in the result, as data.
 *
 * Rendered by whatever displays it — never composed from profile prose. The assistant may
 * phrase these naturally but may not add a reason that is not here (`investigator-discovery`),
 * which is how invented qualifications reach a customer.
 */
export interface MatchedOn {
  /** Declared specialties that satisfied the taxonomy filter, including via the tree walk. */
  taxonomyNodeIds: string[];
  /** Requested languages this investigator works in — all of them, or they would not be here. */
  languages: string[];
  /** The place filters this investigator's service area satisfied. */
  place: { countryCode?: string; region?: string; city?: string } | null;
  /** True when an availability window was asked for and matched. */
  availability: boolean;
}

/**
 * What was asked for and this investigator does not cover, as data (T-018).
 *
 * Only the taxonomy can have a gap. Its nodes are alternatives — any one of them admits an
 * investigator — so a search for due diligence and surveillance returns someone who offers only
 * the first, and saying "does not offer surveillance" is more honest than silence about it. Every
 * other filter must be met in full, or the investigator would not be in the result at all.
 */
export interface NotMatched {
  /** Requested nodes that none of this investigator's declared specialties reach, either way. */
  taxonomyNodeIds: string[];
}

export interface InvestigatorSearchResult extends PublicInvestigatorProfile {
  /** Rounded up to whole kilometres, and null when the search had no location. Never geometry. */
  distanceKm: number | null;
  verificationStatus: 'VERIFIED';
  matchedOn: MatchedOn;
  notMatched: NotMatched;
}

export interface SearchPage {
  items: InvestigatorSearchResult[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** The sort key of the last row on a page, as the cursor carries it. */
export interface SearchCursor {
  distanceM: number | null;
  profileId: string;
}

/**
 * Investigator discovery (plan.md §9, `postgis-search`, `investigator-discovery`).
 *
 * The pipeline, in this order and no other:
 *
 * ```
 * hard filters   country / region / city / taxonomy (incl. tree) / language / availability / pricing
 *   → eligibility  published, VERIFIED, accepting work, account ACTIVE and not deleted
 *   → geography    ST_DWithin filters; ST_Distance only sorts
 *   → quality      experience, where no location decided the order
 *   → projection   public fields only
 * ```
 *
 * **Every stage narrows or reorders. No stage adds.** Eligibility lives in the SQL `WHERE`, not
 * in a filter applied afterwards, so there is no path — no relevance score, no cursor, no
 * filter combination — by which an ineligible investigator reaches a result.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
  ) {}

  async searchInvestigators(
    actor: Actor,
    dto: SearchInvestigatorsDto,
    req: RequestContext,
  ): Promise<SearchPage> {
    const c: AuthzContext = {
      action: 'search.investigators',
      resourceType: 'investigator_profile',
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    // A suspended account does not get to browse. Checked here rather than relying on the
    // guard, because a service is also reachable from a job and from an AI tool.
    await this.authz.requireActive(actor, c);

    const limit = clampLimit(dto.limit);
    // The cursor is bound to the filters that produced it, so page two of one search can never
    // silently become page two of another (docs/api/pagination.md).
    const filters = filterFingerprintInput(dto);
    const cursor = dto.cursor === undefined ? null : decodeCursor(filters, dto.cursor);

    const reach = await taxonomyClosure(this.db, dto.taxonomyNodeIds);
    const closure = [...new Set([...reach.values()].flat())];
    // An empty closure from a non-empty request means every node asked for is unknown: nothing
    // can match, and saying so costs one round trip instead of a pointless scan.
    if (
      dto.taxonomyNodeIds !== undefined &&
      dto.taxonomyNodeIds.length > 0 &&
      closure.length === 0
    ) {
      return { items: [], pageInfo: { nextCursor: null, hasNextPage: false } };
    }

    const rows = (await this.db.execute(
      investigatorSearchQuery(dto, closure, cursor, limit),
    )) as unknown as Array<{ profileId: string; sortKey: number; distanceM: number | null }>;

    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    if (page.length === 0) return { items: [], pageInfo: { nextCursor: null, hasNextPage: false } };

    const items = await this.project(page, dto, reach);
    const last = page[page.length - 1]!;
    return {
      items,
      pageInfo: {
        nextCursor: hasNextPage
          ? encodeCursor(filters, { distanceM: Number(last.sortKey), profileId: last.profileId })
          : null,
        hasNextPage,
      },
    };
  }

  /** Public fields only, in the order the query returned them, with the reasons it matched. */
  private async project(
    page: Array<{ profileId: string; distanceM: number | null }>,
    dto: SearchInvestigatorsDto,
    reach: Map<string, string[]>,
  ): Promise<InvestigatorSearchResult[]> {
    const ids = page.map((r) => r.profileId);
    const [profiles, languages, availability, specialties] = await Promise.all([
      this.db
        .select({ profile: investigatorProfiles, displayName: users.displayName })
        .from(investigatorProfiles)
        .innerJoin(users, sql`${users.id} = ${investigatorProfiles.userId}`)
        .where(inArray(investigatorProfiles.id, ids)),
      this.db
        .select()
        .from(investigatorLanguages)
        .where(inArray(investigatorLanguages.profileId, ids)),
      this.db
        .select()
        .from(investigatorAvailability)
        .where(inArray(investigatorAvailability.profileId, ids)),
      this.db
        .select()
        .from(investigatorSpecialties)
        .where(inArray(investigatorSpecialties.profileId, ids)),
    ]);

    const byId = new Map(profiles.map((p) => [p.profile.id, p]));
    const requestedLanguages = new Set(dto.languages ?? []);
    const closureSet = new Set([...reach.values()].flat());

    return page.flatMap((row) => {
      const found = byId.get(row.profileId);
      // A row that vanished between the two queries is dropped rather than half-rendered.
      if (found === undefined) return [];
      const rel = {
        displayName: found.displayName,
        languages: languages.filter((l) => l.profileId === row.profileId),
        availability: availability.filter((a) => a.profileId === row.profileId),
        specialtyNodeIds: specialties
          .filter((s) => s.profileId === row.profileId)
          .map((s) => s.taxonomyNodeId),
      };
      const place =
        dto.countryCode === undefined && dto.region === undefined && dto.city === undefined
          ? null
          : {
              ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
              ...(dto.region !== undefined ? { region: dto.region } : {}),
              ...(dto.city !== undefined ? { city: dto.city } : {}),
            };

      return [
        {
          ...toPublicInvestigatorProfile(found.profile, rel),
          distanceKm: row.distanceM === null ? null : toReportedKm(Number(row.distanceM)),
          // Everyone here is verified; the filter is not optional, so neither is the value.
          verificationStatus: 'VERIFIED' as const,
          matchedOn: {
            taxonomyNodeIds: rel.specialtyNodeIds.filter((id) => closureSet.has(id)),
            languages: rel.languages
              .map((l) => l.languageCode)
              .filter((code) => requestedLanguages.has(code)),
            place,
            availability: dto.availableDuring !== undefined,
          },
          notMatched: {
            taxonomyNodeIds: [...reach]
              .filter(([, nodes]) => !nodes.some((id) => rel.specialtyNodeIds.includes(id)))
              .map(([requested]) => requested),
          },
        },
      ];
    });
  }
}

/**
 * The search, as one statement.
 *
 * One statement because eligibility and ranking must not be separable: a second pass that
 * filters in application code is a pass somebody can forget to run.
 *
 * Exported, and a pure function of its arguments, so the query-plan test can EXPLAIN exactly
 * what production runs rather than a lookalike rewritten for the test — the same reason T-009
 * exports its coverage query.
 */
export function investigatorSearchQuery(
  dto: SearchInvestigatorsDto,
  closure: string[],
  cursor: SearchCursor | null,
  limit: number,
): SQL {
  const usesArea =
    dto.near !== undefined ||
    dto.countryCode !== undefined ||
    dto.region !== undefined ||
    dto.city !== undefined;

  const where: SQL[] = [
    // Eligibility. None of these is a preference a caller expresses.
    sql`ip.visibility = 'PUBLISHED'`,
    sql`ip.verification_status = 'VERIFIED'`,
    sql`ip.accepting_work = true`,
    sql`u.status = 'ACTIVE'`,
    sql`u.deleted_at IS NULL`,
  ];

  if (dto.countryCode !== undefined) where.push(sql`sa.country_code = ${dto.countryCode}`);
  // Case-insensitive: an investigator writing "yerevan" and a customer typing "Yerevan" mean
  // the same city, and neither should have to guess the other's capitalisation.
  if (dto.region !== undefined) where.push(sql`lower(sa.region) = lower(${dto.region})`);
  if (dto.city !== undefined) where.push(sql`lower(sa.city) = lower(${dto.city})`);

  const point =
    dto.near === undefined
      ? null
      : sql`ST_SetSRID(ST_MakePoint(${dto.near.lon}, ${dto.near.lat}), 4326)::geography`;
  if (point !== null) {
    // ST_DWithin filters, with a constant distance, so the GIST index is usable. ST_Distance
    // only ever sorts — `WHERE ST_Distance(...) < x` cannot use the index and scans.
    where.push(sql`ST_DWithin(sa.area, ${point}, ${(dto.radiusKm ?? 0) * 1000})`);
  }

  // Every requested language, not any: someone who needs Armenian and English needs both.
  for (const language of dto.languages ?? []) {
    where.push(
      sql`EXISTS (SELECT 1 FROM investigator_languages il WHERE il.profile_id = ip.id AND il.language_code = ${language})`,
    );
  }

  // Any of the requested nodes, expanded through the tree in both directions (ADR-0007).
  if (closure.length > 0) {
    const ids = sql.join(
      closure.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    where.push(
      sql`EXISTS (SELECT 1 FROM investigator_specialties s WHERE s.profile_id = ip.id AND s.taxonomy_node_id IN (${ids}))`,
    );
  }

  if (dto.availableDuring !== undefined) {
    const { dayOfWeek, startMinute, endMinute } = dto.availableDuring;
    // Overlap, not containment: a customer asking about Tuesday morning wants anyone free for
    // part of it, and strict containment would hide most of them.
    where.push(
      sql`EXISTS (SELECT 1 FROM investigator_availability a WHERE a.profile_id = ip.id
            AND a.day_of_week = ${dayOfWeek} AND a.start_minute < ${endMinute} AND a.end_minute > ${startMinute})`,
    );
  }

  if (dto.pricingModel !== undefined) {
    where.push(sql`ip.pricing_model = ${dto.pricingModel}::pricing_model`);
  }

  /**
   * One sort key, ascending, whatever the query shape — so the cursor has one meaning.
   *
   * With a location it is distance. Without one it is negated experience, which puts the most
   * experienced first and the undeclared last. Rating and response time belong here too and do
   * not exist yet: reviews are T-037. Ordering by a quality signal the platform has not
   * collected would be inventing one.
   */
  const sortKey =
    point === null
      ? sql`(-COALESCE(ip.years_experience, 0))::double precision`
      : sql`min(ST_Distance(sa.area, ${point}))`;

  const having =
    cursor === null
      ? sql``
      : // Keyset, on the sort key plus the id that breaks its ties. In HAVING because with a
        // location the key is an aggregate.
        sql` HAVING (${sortKey}, ip.id) > (${cursor.distanceM ?? 0}::double precision, ${cursor.profileId}::uuid)`;

  return sql`
    SELECT ip.id AS "profileId",
           ${sortKey} AS "sortKey",
           ${point === null ? sql`NULL::double precision` : sql`min(ST_Distance(sa.area, ${point}))`} AS "distanceM"
    FROM investigator_profiles ip
    JOIN users u ON u.id = ip.user_id
    ${usesArea ? sql`JOIN service_areas sa ON sa.profile_id = ip.id` : sql``}
    WHERE ${sql.join(where, sql` AND `)}
    GROUP BY ip.id
    ${having}
    ORDER BY "sortKey" ASC, ip.id ASC
    LIMIT ${limit + 1}`;
}

/** What the cursor's fingerprint is taken over: the filters, never the paging arguments. */
function filterFingerprintInput(dto: SearchInvestigatorsDto) {
  const { limit: _limit, cursor: _cursor, ...filters } = dto;
  return filters;
}
