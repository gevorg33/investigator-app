import { Injectable } from '@nestjs/common';
import type { Actor, Role } from '../../../../common/authz/contract';
import type { RequestContext } from '../../../../common/http/request-context';
import type { SearchInvestigatorsDto } from '../../../search/search.dto';
import { SearchService, type InvestigatorSearchResult } from '../../../search/search.service';
import { TaxonomyService } from '../../../taxonomy/taxonomy.service';
import type { AssistantTool } from '../assistant-tool';
import {
  DEFAULT_TOOL_RESULTS,
  searchInvestigatorsInput,
  searchInvestigatorsOutput,
  type InvestigatorMatch,
  type SearchInvestigatorsInput,
  type SearchInvestigatorsOutput,
} from './discovery.schemas';
import { rankByRelevance } from './relevance';

/**
 * How many eligible investigators a relevance hint may reorder. The hint picks the best-fitting
 * few from this many, in the search's own order; it never looks further than the filters and
 * eligibility already allowed.
 */
export const CANDIDATE_POOL = 50;

/**
 * `searchInvestigators` — find investigators by place, distance, specialty, language and weekly
 * availability, with the reasons each one matched (T-018).
 *
 * **Not RAG.** It calls `SearchService` — the HTTP search's own service — so the filters,
 * eligibility and geography are one implementation: published, VERIFIED, accepting work, account
 * ACTIVE and not deleted, enforced in SQL before anything is ranked (docs/architecture/discovery.md).
 * The relevance hint then reorders what that returned, and can do nothing else.
 */
@Injectable()
export class SearchInvestigatorsTool implements AssistantTool<
  SearchInvestigatorsInput,
  SearchInvestigatorsOutput
> {
  readonly name = 'searchInvestigators';
  readonly description =
    'Find verified investigators who are accepting work, filtered by place, distance, ' +
    'specialty, language and weekly availability, with what each matched and did not.';
  // The HTTP search admits any signed-in active account, and this is the same search.
  readonly requiredRoles: readonly Role[] = ['CUSTOMER', 'INVESTIGATOR', 'STAFF'];
  readonly resourceScope = 'public_projection' as const;
  readonly operation = 'read' as const;
  readonly confirmation = 'none' as const;
  readonly input = searchInvestigatorsInput;
  readonly output = searchInvestigatorsOutput;
  readonly auditEvent = 'ai.tool.search_investigators';
  readonly rateLimit = { perMinute: 30 };

  constructor(
    private readonly search: SearchService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  /** Which filters were used, never their values: a place or a point can be the subject's. */
  auditArguments(input: SearchInvestigatorsInput): string {
    const used = [
      input.place?.countryCode !== undefined && 'countryCode',
      input.place?.region !== undefined && 'region',
      input.place?.city !== undefined && 'city',
      input.near !== undefined && 'near',
      input.taxonomyNodeIds !== undefined && `taxonomy(${input.taxonomyNodeIds.length})`,
      input.languages !== undefined && `languages(${input.languages.length})`,
      input.availableDuring !== undefined && 'availability',
      input.relevanceHint !== undefined && 'relevanceHint',
    ].filter((f): f is string => f !== false);
    return `filters=${used.join(',') || 'none'}`;
  }

  async execute(
    actor: Actor,
    input: SearchInvestigatorsInput,
    req: RequestContext,
  ): Promise<SearchInvestigatorsOutput> {
    const dto: SearchInvestigatorsDto = {
      // Zod leaves an absent field out rather than setting it to undefined, which is the shape
      // the DTO's exact optional properties describe.
      ...(input.place as Pick<SearchInvestigatorsDto, 'countryCode' | 'region' | 'city'>),
      ...(input.near !== undefined
        ? { near: { lon: input.near.lon, lat: input.near.lat }, radiusKm: input.near.radiusKm }
        : {}),
      ...(input.taxonomyNodeIds !== undefined ? { taxonomyNodeIds: input.taxonomyNodeIds } : {}),
      ...(input.languages !== undefined ? { languages: input.languages } : {}),
      ...(input.availableDuring !== undefined ? { availableDuring: input.availableDuring } : {}),
      limit: CANDIDATE_POOL,
    };
    const page = await this.search.searchInvestigators(actor, dto, req);

    let candidates = page.items;
    let orderedBy: SearchInvestigatorsOutput['orderedBy'] =
      input.near !== undefined ? 'distance' : 'experience';
    // Distance was asked for when a point was given; a hint does not overrule it.
    if (input.relevanceHint !== undefined && input.near === undefined) {
      const ranked = rankByRelevance(candidates, input.relevanceHint, (i) =>
        [i.headline, i.bio].join(' '),
      );
      if (ranked.reordered) {
        candidates = ranked.items;
        orderedBy = 'relevance';
      }
    }

    const limit = input.limit ?? DEFAULT_TOOL_RESULTS;
    const shown = candidates.slice(0, limit);
    const labels = await this.taxonomy.labels(
      shown.flatMap((i) => [...i.specialtyNodeIds, ...i.notMatched.taxonomyNodeIds]),
      input.locale,
    );
    return {
      results: shown.map((i) => toMatch(i, input, labels)),
      // A further page implies a full pool, which is always more than the limit — so the pool's
      // length alone answers it.
      hasMore: candidates.length > limit,
      orderedBy,
    };
  }
}

function toMatch(
  i: InvestigatorSearchResult,
  input: SearchInvestigatorsInput,
  labels: ReadonlyMap<string, string>,
): InvestigatorMatch {
  const label = (id: string) => ({ id, label: labels.get(id) ?? null });
  return {
    investigatorId: i.id,
    displayName: i.displayName,
    headline: i.headline,
    yearsExperience: i.yearsExperience,
    verificationStatus: i.verificationStatus,
    languages: i.languages.map((l) => ({ code: l.languageCode, proficiency: l.proficiency })),
    specialties: i.specialtyNodeIds.map(label),
    availability: i.availability,
    distanceKm: i.distanceKm,
    matchedOn: {
      taxonomy: i.matchedOn.taxonomyNodeIds.map(label),
      languages: i.matchedOn.languages,
      place: i.matchedOn.place,
      availability: i.matchedOn.availability ? input.availableDuring! : null,
    },
    notMatched: { taxonomy: i.notMatched.taxonomyNodeIds.map(label) },
  };
}
