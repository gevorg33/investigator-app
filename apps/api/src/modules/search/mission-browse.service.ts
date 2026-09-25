import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { AppError, type FieldIssue } from '../../common/errors/app-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { missions, savedMissionSearches, serviceAreas } from '../../database/schema';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { requireQuotingProfile } from '../profiles/quoting-eligibility';
import { toReportedKm } from '../service-areas/service-areas.policy';
import type {
  BrowseMissionsDto,
  MissionBrowseFiltersDto,
  MissionSort,
  SaveMissionSearchDto,
} from './mission-browse.dto';
import { clampLimit, decodeKeyset, encodeKeyset, type Keyset } from './search.policy';
import { taxonomyClosure } from './taxonomy-closure';

/**
 * A published mission as an investigator browsing sees it (T-054).
 *
 * What a quote needs, and nothing about the customer: no id, no name, no contact, no workspace.
 * Nor the customer's statement of purpose, their relationship to the subject or a protective-order
 * declaration — those are for the moderator who published the mission, not for everyone who could
 * quote on it. The location is its label and a rounded distance, never coordinates.
 */
export interface MissionListing {
  id: string;
  title: string;
  description: string;
  taxonomyNodeId: string;
  countryCode: string;
  locationLabel: string | null;
  /** Whole kilometres, rounded up, from the service area measured against; null without one. */
  distanceKm: number | null;
  startBy: string | null;
  deadline: string;
  budgetMinMinor: number;
  budgetMaxMinor: number;
  currency: string;
  languages: string[];
  publishedAt: Date;
}

export interface MissionBrowsePage {
  items: MissionListing[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

export interface SavedMissionSearch {
  id: string;
  name: string;
  filters: MissionBrowseFiltersDto;
  createdAt: Date;
}

/** How many searches one investigator may keep, per workspace. */
export const MAX_SAVED_SEARCHES = 20;

/**
 * Stands in for "no distance" in the closest-first key, so missions without a location sort last.
 * Nothing else a published mission carries can be missing: `missions_submission_complete` requires
 * a deadline, both ends of the budget, a currency and at least one language.
 */
const LAST = 1e15;

/**
 * Browsing the missions an investigator could quote on (plan.md §9 "Discover eligible missions").
 *
 * The pipeline, in this order and no other:
 *
 * ```
 * eligibility   the actor may quote (requireQuotingProfile) → the mission is QUOTED, not their own
 *   → filters   taxonomy (tree), budget, deadline, distance, language, posted — each only narrows
 *   → order     newest / closest / budget / deadline / relevance, then newest, then id
 *   → projection  MissionListing: nothing about the customer
 * ```
 *
 * Eligibility is in the SQL `WHERE` with the filters, never applied afterwards — so no filter,
 * sort, free text or cursor can bring an ineligible mission into a page. Free text orders; it
 * never filters (`investigator-discovery`).
 */
@Injectable()
export class MissionBrowseService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly profiles: OwnInvestigatorProfileRepository,
  ) {}

  async browse(
    actor: Actor,
    dto: BrowseMissionsDto,
    req: RequestContext,
  ): Promise<MissionBrowsePage> {
    const c = ctx('mission.browse', req);
    const profile = await requireQuotingProfile(this.authz, this.profiles, actor, c);
    const { cursor: rawCursor, limit: rawLimit, ...filters } = dto;
    const sort = await this.check(filters, profile.id);

    const limit = clampLimit(rawLimit);
    const cursor = rawCursor === undefined ? null : decodeKeyset(filters, rawCursor, 2);

    const reach = await taxonomyClosure(this.db, filters.taxonomyNodeIds);
    const closure = [...new Set([...reach.values()].flat())];
    // Every requested node unknown: nothing can match, and saying so costs no scan.
    if ((filters.taxonomyNodeIds?.length ?? 0) > 0 && closure.length === 0) return empty();

    const rows = (await this.db.execute(
      missionBrowseQuery({
        filters,
        sort,
        closure,
        actorUserId: actor.userId,
        profileId: profile.id,
        cursor,
        limit,
      }),
    )) as unknown as Array<{ id: string; k1: number; k2: number; distanceM: number | null }>;

    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);
    if (page.length === 0) return empty();

    const items = await this.project(page);
    const last = page[page.length - 1]!;
    return {
      items,
      pageInfo: {
        nextCursor: hasNextPage
          ? encodeKeyset(filters, { keys: [Number(last.k1), Number(last.k2)], id: last.id })
          : null,
        hasNextPage,
      },
    };
  }

  // ── Saved searches ────────────────────────────────────────────────────────────

  async listSaved(actor: Actor, req: RequestContext): Promise<SavedMissionSearch[]> {
    await this.requireInvestigator(actor, ctx('mission.saved_search.list', req));
    // Row-level security admits this user's own, in this workspace, and nothing else.
    const rows = await this.db
      .select()
      .from(savedMissionSearches)
      .orderBy(desc(savedMissionSearches.createdAt), desc(savedMissionSearches.id));
    return rows.map(toSaved);
  }

  async save(
    actor: Actor,
    dto: SaveMissionSearchDto,
    req: RequestContext,
  ): Promise<SavedMissionSearch> {
    const c = ctx('mission.saved_search.create', req);
    const profile = await requireQuotingProfile(this.authz, this.profiles, actor, c);
    // Checked as a browse would check it, so a saved search is one that runs.
    await this.check(dto.filters, profile.id);
    // Stored as plain JSON: only the fields that were given.
    const filters = JSON.parse(JSON.stringify(dto.filters)) as MissionBrowseFiltersDto;
    const name = dto.name.trim();

    return this.db.transaction(async (tx) => {
      // Serialises this user's saves, so two at once cannot both pass the count.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext('saved_mission_searches:' || ${actor.userId}))`,
      );
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(savedMissionSearches);
      if (count >= MAX_SAVED_SEARCHES) {
        throw AppError.validation([
          { field: 'name', code: 'LIMIT', messageKey: 'error.validation.saved_search.limit' },
        ]);
      }
      const clash = await tx
        .select({ id: savedMissionSearches.id })
        .from(savedMissionSearches)
        .where(eq(savedMissionSearches.name, name));
      if (clash.length > 0) {
        throw AppError.validation([
          { field: 'name', code: 'TAKEN', messageKey: 'error.validation.saved_search.name_taken' },
        ]);
      }
      const [row] = await tx.insert(savedMissionSearches).values({ name, filters }).returning();
      return toSaved(row!);
    });
  }

  async removeSaved(actor: Actor, id: string, req: RequestContext): Promise<void> {
    const c = ctx('mission.saved_search.delete', req, id);
    await this.requireInvestigator(actor, c);
    const deleted = await this.db
      .delete(savedMissionSearches)
      .where(eq(savedMissionSearches.id, id))
      .returning({ id: savedMissionSearches.id });
    // Someone else's reads exactly like one that never existed.
    await this.authz.visible(actor, deleted[0], c);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  /** Saved searches are the investigator's own tool; the list stays readable if eligibility lapses. */
  private async requireInvestigator(actor: Actor, c: AuthzContext): Promise<void> {
    await this.authz.requireActive(actor, c);
    await this.authz.requireRole(actor, 'INVESTIGATOR', c);
  }

  /**
   * The rules no single field can state, and the sort they resolve to. Every refusal names the
   * field to change: a filter that cannot mean anything is refused, never quietly dropped.
   */
  private async check(f: MissionBrowseFiltersDto, profileId: string): Promise<MissionSort> {
    const issues: FieldIssue[] = [];
    const sort: MissionSort = f.sort ?? (f.q !== undefined ? 'relevance' : 'newest');

    const usesBudget =
      f.budgetMinMinor !== undefined || f.budgetMaxMinor !== undefined || sort === 'budget';
    if (usesBudget && f.currency === undefined) {
      issues.push({
        field: 'currency',
        code: 'REQUIRED',
        messageKey: 'error.validation.currency.required',
      });
    }
    if (
      f.budgetMinMinor !== undefined &&
      f.budgetMaxMinor !== undefined &&
      f.budgetMinMinor > f.budgetMaxMinor
    ) {
      issues.push({
        field: 'budgetMaxMinor',
        code: 'RANGE',
        messageKey: 'error.validation.budget.range',
      });
    }
    if (
      f.deadlineFrom !== undefined &&
      f.deadlineTo !== undefined &&
      f.deadlineFrom > f.deadlineTo
    ) {
      issues.push({
        field: 'deadlineTo',
        code: 'RANGE',
        messageKey: 'error.validation.deadline.range',
      });
    }
    if (sort === 'relevance' && f.q === undefined) {
      issues.push({
        field: 'q',
        code: 'REQUIRED',
        messageKey: 'error.validation.browse.relevance_needs_text',
      });
    }
    if (f.q !== undefined && sort !== 'relevance') {
      // Free text only orders. Under any other order it would do nothing, and silently.
      issues.push({
        field: 'sort',
        code: 'CONFLICT',
        messageKey: 'error.validation.browse.text_orders_only',
      });
    }
    if (f.serviceAreaId !== undefined) {
      const [area] = await this.db
        .select({ id: serviceAreas.id })
        .from(serviceAreas)
        .where(and(eq(serviceAreas.id, f.serviceAreaId), eq(serviceAreas.profileId, profileId)));
      if (area === undefined) {
        issues.push({
          field: 'serviceAreaId',
          code: 'NOT_FOUND',
          messageKey: 'error.validation.service_area.unknown',
        });
      }
    }
    if (issues.length > 0) throw AppError.validation(issues);
    return sort;
  }

  /** The listing fields, in the order the query chose. */
  private async project(
    page: Array<{ id: string; distanceM: number | null }>,
  ): Promise<MissionListing[]> {
    const rows = await this.db
      .select({
        id: missions.id,
        title: missions.title,
        description: missions.description,
        taxonomyNodeId: missions.taxonomyNodeId,
        countryCode: missions.countryCode,
        locationLabel: missions.locationLabel,
        startBy: missions.startBy,
        deadline: missions.deadline,
        budgetMinMinor: missions.budgetMinMinor,
        budgetMaxMinor: missions.budgetMaxMinor,
        currency: missions.currency,
        languages: missions.languages,
        publishedAt: missions.publishedAt,
      })
      .from(missions)
      // Still published: a mission hired or withdrawn between the two reads is dropped, not shown.
      .where(
        and(
          inArray(
            missions.id,
            page.map((r) => r.id),
          ),
          eq(missions.status, 'QUOTED'),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return page.flatMap((p) => {
      const r = byId.get(p.id);
      if (r === undefined) return [];
      return [
        {
          // A published mission is complete by constraint (missions_submission_complete).
          ...r,
          title: r.title!,
          description: r.description!,
          taxonomyNodeId: r.taxonomyNodeId!,
          countryCode: r.countryCode!,
          deadline: r.deadline!,
          budgetMinMinor: r.budgetMinMinor!,
          budgetMaxMinor: r.budgetMaxMinor!,
          currency: r.currency!,
          publishedAt: r.publishedAt!,
          distanceKm: p.distanceM === null ? null : toReportedKm(Number(p.distanceM)),
        },
      ];
    });
  }
}

/**
 * The browse, as one statement — eligibility, filters, order and page together, so no second pass
 * exists to be forgotten. Exported and pure, so the query-plan test EXPLAINs exactly this.
 */
export function missionBrowseQuery(input: {
  filters: MissionBrowseFiltersDto;
  sort: MissionSort;
  closure: string[];
  actorUserId: string;
  profileId: string;
  cursor: Keyset | null;
  limit: number;
}): SQL {
  const { filters: f, sort, closure, actorUserId, profileId, cursor, limit } = input;

  const where: SQL[] = [
    // Eligibility. Not a filter anyone sets, and nothing below can loosen it.
    sql`m.status = 'QUOTED'`,
    // Nobody browses their own mission for work: one account holds both roles.
    sql`m.customer_id <> ${actorUserId}::uuid`,
  ];

  if (closure.length > 0) {
    where.push(
      sql`m.taxonomy_node_id IN (${sql.join(
        closure.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
  }

  if (f.currency !== undefined) where.push(sql`m.currency = ${f.currency}`);
  // Overlap: the mission's range reaches the minimum, and starts at or below the maximum.
  if (f.budgetMinMinor !== undefined) {
    where.push(sql`m.budget_max_minor >= ${f.budgetMinMinor}`);
  }
  if (f.budgetMaxMinor !== undefined) {
    where.push(sql`m.budget_min_minor <= ${f.budgetMaxMinor}`);
  }

  if (f.deadlineFrom !== undefined) where.push(sql`m.deadline >= ${f.deadlineFrom}::date`);
  if (f.deadlineTo !== undefined) where.push(sql`m.deadline <= ${f.deadlineTo}::date`);

  // Every language the mission requires is one the investigator works in.
  if (f.languages !== undefined) {
    where.push(
      sql`m.languages <@ ARRAY[${sql.join(
        f.languages.map((l) => sql`${l}`),
        sql`, `,
      )}]::text[]`,
    );
  }

  if (f.postedWithinDays !== undefined) {
    where.push(sql`m.published_at >= now() - make_interval(days => ${f.postedWithinDays})`);
  }

  // The investigator's own service areas: the one named, or all of them.
  const areas = sql`FROM service_areas sa WHERE sa.profile_id = ${profileId}::uuid${
    f.serviceAreaId === undefined ? sql`` : sql` AND sa.id = ${f.serviceAreaId}::uuid`
  }`;
  if (f.withinKm !== undefined) {
    // ST_DWithin filters, with a constant distance, so the GIST index is usable. ST_Distance only sorts.
    where.push(
      sql`EXISTS (SELECT 1 ${areas} AND ST_DWithin(m.location, sa.area, ${f.withinKm * 1000}))`,
    );
  }
  const measured = f.serviceAreaId !== undefined || f.withinKm !== undefined || sort === 'closest';
  const distance = measured ? sql`(SELECT min(ST_Distance(m.location, sa.area)) ${areas})` : null;

  const newest = sql`(-extract(epoch FROM m.published_at))::double precision`;
  const k1 = ((): SQL => {
    switch (sort) {
      case 'closest':
        return sql`COALESCE(${distance}, ${LAST})::double precision`;
      case 'budget':
        return sql`(-m.budget_max_minor)::double precision`;
      case 'deadline':
        return sql`extract(epoch FROM m.deadline::timestamp)::double precision`;
      // `check` has made sure relevance always comes with words to look for.
      case 'relevance':
        return sql`(-ts_rank(to_tsvector('simple', m.title || ' ' || m.description), plainto_tsquery('simple', ${f.q!})))::double precision`;
      default:
        return newest;
    }
  })();

  if (cursor !== null) {
    where.push(
      sql`(${k1}, ${newest}, m.id) > (${cursor.keys[0]}::double precision, ${cursor.keys[1]}::double precision, ${cursor.id}::uuid)`,
    );
  }

  return sql`
    SELECT m.id AS "id", ${k1} AS "k1", ${newest} AS "k2",
           ${distance ?? sql`NULL::double precision`} AS "distanceM"
    FROM missions m
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY "k1" ASC, "k2" ASC, m.id ASC
    LIMIT ${limit + 1}`;
}

const empty = (): MissionBrowsePage => ({
  items: [],
  pageInfo: { nextCursor: null, hasNextPage: false },
});

const ctx = (action: string, req: RequestContext, resourceId?: string): AuthzContext => ({
  action,
  resourceType: 'mission',
  ...(resourceId !== undefined ? { resourceId } : {}),
  correlationId: req.correlationId,
  ipAddress: req.ip,
});

const toSaved = (r: typeof savedMissionSearches.$inferSelect): SavedMissionSearch => ({
  id: r.id,
  name: r.name,
  filters: r.filters as MissionBrowseFiltersDto,
  createdAt: r.createdAt,
});
