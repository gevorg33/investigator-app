import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { currentContext } from '../../../common/context/execution-context';
import { AppError } from '../../../common/errors/app-error';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ProviderError } from '../../../common/errors/provider-error';
import type { RequestContext } from '../../../common/http/request-context';
import { DB, type Db } from '../../../database/database.module';
import type { KnowledgeLocale } from '../../../database/schema';
import { RateLimitService } from '../../auth/rate-limit.service';
import { RULESET_VERSION } from '../../mission-policy/mission-policy.rules';
import { matchingTextRules } from '../../mission-policy/mission-screening';
import { CHAT_MODEL, type ChatModel } from '../chat-model';
import type {
  InvestigatorMatch,
  MatchedOnView,
  NodeLabel,
  SearchInvestigatorsInput,
  SearchInvestigatorsOutput,
} from '../tools/discovery/discovery.schemas';
import { ListTaxonomyTool } from '../tools/discovery/list-taxonomy.tool';
import { SearchInvestigatorsTool } from '../tools/discovery/search-investigators.tool';
import { ToolRunner } from '../tools/tool-runner';
import { savedLocale } from '../user-locale';
import { explainMatch, type MatchReason } from './discovery-explanation';
import {
  DISCOVERY_PROMPT_VERSION,
  discoveryPrompt,
  parseProposal,
  type DiscoveryProposal,
} from './discovery-proposal';

/** The knowledge-base article a refusal points to: the policy, in words a customer reads. */
export const PROHIBITED_REQUESTS_DOCUMENT = 'kb-policy-prohibited-requests';

export interface DiscoveryRequest {
  question: string;
  locale?: KnowledgeLocale | undefined;
  /** From the person's device or a map pin. Never sent to the model. */
  near?: { lon: number; lat: number } | undefined;
  radiusKm?: number | undefined;
  /** The specialty the person picked when asked which one they meant. Overrides the model's. */
  taxonomyNodeIds?: string[] | undefined;
  /** The answer to "what is this for?", when that was asked. */
  purpose?: string | undefined;
}

/** What was searched, as a person can check it — the stated assumption, not a hidden one. */
export interface SearchedFor {
  place: MatchedOnView['place'];
  /** A point was given. Never the point itself. */
  near: boolean;
  radiusKm: number | null;
  specialties: NodeLabel[];
  languages: string[];
  availability: MatchedOnView['availability'];
}

export type Clarification =
  { code: 'purpose' } | { code: 'location' } | { code: 'specialty'; options: NodeLabel[] };

export interface DiscoveryMatch extends InvestigatorMatch {
  explanation: MatchReason[];
}

export interface DiscoveryAnswer {
  /**
   * - `results` / `no_results`: a search ran on `searchedFor`.
   * - `clarification`: one question, because the answer depends on it.
   * - `refused`: the request trips the deterministic lawful-use rules. Nothing was searched.
   * - `not_discovery`: not a request to find an investigator; ask the knowledge assistant.
   * - `not_understood`: the request could not be turned into filters. Nothing was guessed.
   */
  status:
    'results' | 'no_results' | 'clarification' | 'refused' | 'not_discovery' | 'not_understood';
  locale: KnowledgeLocale;
  searchedFor: SearchedFor | null;
  /** Said out loud, so a person can narrow: `location.anywhere` — no place was given. */
  assumptions: Array<'location.anywhere'>;
  orderedBy: SearchInvestigatorsOutput['orderedBy'] | null;
  results: DiscoveryMatch[];
  hasMore: boolean;
  clarification: Clarification | null;
  refusal: { code: 'prohibited_request'; document: typeof PROHIBITED_REQUESTS_DOCUMENT } | null;
}

/**
 * The assistant finding investigators (T-018, `investigator-discovery`).
 *
 * ```
 * actor → workspace → lawful-use rules → taxonomy (tool) → model proposes filters → validate
 *   → clarify only if it changes the answer → search (tool) → explain from matchedOn → audit
 * ```
 *
 * **Not RAG.** Who can help comes from live SQL through the discovery tools, never from
 * documentation. **The model writes nothing the person reads.** It turns the request into typed
 * filters and a classification; the search runs as the caller, and every reason given for a
 * match is rendered from what the search returned. So the answer cannot hold a price, an
 * availability window or a capability the data does not.
 *
 * **Policy is decided by rules, not by the model.** The request is screened by the same
 * deterministic detector missions are, before any model call; a match is refused and points to
 * the policy. The model may flag a concern — that asks what the search is for, once, and the
 * stated purpose is screened by the same rules. It never refuses anyone on its own.
 *
 * Stateless, like the knowledge answer: the request is not stored. The audit row records the
 * outcome, the counts, the model and the instructions — never the request.
 */
@Injectable()
export class DiscoveryAnswerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly tools: ToolRunner,
    private readonly listTaxonomy: ListTaxonomyTool,
    private readonly searchInvestigators: SearchInvestigatorsTool,
    @Inject(CHAT_MODEL) private readonly model: ChatModel | null,
  ) {}

  async answer(
    actor: Actor,
    input: DiscoveryRequest,
    req: RequestContext,
  ): Promise<DiscoveryAnswer> {
    const c: AuthzContext = {
      action: 'assistant.discovery_answer',
      resourceType: 'investigator_profile',
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    await this.authz.requireActive(actor, c);
    await this.authz.requireWorkspace(actor, currentContext() !== undefined, c);
    // Before the rate limit: an unconfigured assistant should not spend anyone's allowance.
    if (this.model === null) throw new AppError(ErrorCode.SERVICE_UNAVAILABLE);
    await this.limits.consume('assistantQuestionPerAccount', actor.userId);

    const locale = input.locale ?? (await savedLocale(this.db, actor.userId));
    const empty = emptyAnswer(locale);

    const flagged = this.screen(input.question, input.purpose);
    if (flagged.length > 0) return this.refuse(actor, empty, flagged, req);

    try {
      const taxonomy = await this.tools.invoke(actor, this.listTaxonomy, { locale }, req);
      const prompt = discoveryPrompt(input.question, input.purpose, taxonomy.nodes);
      const proposal = parseProposal(await this.model.complete(prompt), prompt.refs);
      if (proposal === null) {
        return await this.finish(actor, { ...empty, status: 'not_understood' }, req);
      }
      if (proposal.intent === 'other') {
        return await this.finish(actor, { ...empty, status: 'not_discovery' }, req);
      }
      // The hint is the one piece of the model's own wording that reaches a tool. Screened too.
      const hintFlags = this.screen(proposal.relevanceHint ?? '');
      if (hintFlags.length > 0) return await this.refuse(actor, empty, hintFlags, req);

      const labels = new Map(taxonomy.nodes.map((n) => [n.id, n.label]));
      const label = (id: string): NodeLabel => ({ id, label: labels.get(id) ?? null });
      return await this.search(actor, input, proposal, locale, label, req);
    } catch (e) {
      // A provider that is down is a 503 the client can retry, not our 500.
      if (e instanceof ProviderError) throw new AppError(ErrorCode.SERVICE_UNAVAILABLE);
      throw e;
    }
  }

  private async search(
    actor: Actor,
    input: DiscoveryRequest,
    proposal: DiscoveryProposal,
    locale: KnowledgeLocale,
    label: (id: string) => NodeLabel,
    req: RequestContext,
  ): Promise<DiscoveryAnswer> {
    const empty = emptyAnswer(locale);
    const concern = proposal.policyConcern ? ', policy_concern' : '';

    // At most one question, and only one whose answer changes the result.
    // 1. What it is for — the only thing that decides whether a borderline request is lawful.
    if (proposal.policyConcern && input.purpose === undefined) {
      return this.finish(
        actor,
        { ...empty, status: 'clarification', clarification: { code: 'purpose' } },
        req,
        concern,
      );
    }
    // 2. Where — "nearest" has no answer without a real point, and the model cannot supply one.
    if (proposal.nearest && input.near === undefined && proposal.place === null) {
      return this.finish(
        actor,
        { ...empty, status: 'clarification', clarification: { code: 'location' } },
        req,
        concern,
      );
    }

    const picked = input.taxonomyNodeIds !== undefined;
    const taxonomyNodeIds = input.taxonomyNodeIds ?? proposal.taxonomyNodeIds;
    const args: SearchInvestigatorsInput = {
      ...(proposal.place !== null ? { place: proposal.place } : {}),
      ...(input.near !== undefined
        ? { near: { ...input.near, radiusKm: input.radiusKm ?? 0 } }
        : {}),
      ...(taxonomyNodeIds.length > 0 ? { taxonomyNodeIds } : {}),
      ...(proposal.languages.length > 0 ? { languages: proposal.languages } : {}),
      ...(proposal.availability !== null ? { availableDuring: proposal.availability } : {}),
      ...(proposal.relevanceHint !== null ? { relevanceHint: proposal.relevanceHint } : {}),
      locale,
    };
    const found = await this.tools.invoke(actor, this.searchInvestigators, args, req);

    // 3. Which specialty — only when the alternatives lead to different people. If everyone shown
    // offers every alternative, choosing one would change nothing, and asking would be noise.
    if (
      !picked &&
      proposal.ambiguous &&
      taxonomyNodeIds.length > 1 &&
      found.results.some((r) => r.notMatched.taxonomy.length > 0)
    ) {
      return this.finish(
        actor,
        {
          ...empty,
          status: 'clarification',
          clarification: { code: 'specialty', options: taxonomyNodeIds.map(label) },
        },
        req,
        concern,
      );
    }

    return this.finish(
      actor,
      {
        ...empty,
        status: found.results.length > 0 ? 'results' : 'no_results',
        searchedFor: {
          place: args.place ?? null,
          near: args.near !== undefined,
          radiusKm: args.near?.radiusKm ?? null,
          specialties: taxonomyNodeIds.map(label),
          languages: args.languages ?? [],
          availability: args.availableDuring ?? null,
        },
        assumptions:
          args.place === undefined && args.near === undefined ? ['location.anywhere'] : [],
        orderedBy: found.orderedBy,
        results: found.results.map((r) => ({ ...r, explanation: explainMatch(r) })),
        hasMore: found.hasMore,
      },
      req,
      concern,
    );
  }

  /** The deterministic lawful-use rules, over everything the person wrote. */
  private screen(...texts: Array<string | undefined>): string[] {
    return matchingTextRules(texts.filter((t) => t !== undefined).join('\n')).map((r) => r.id);
  }

  private refuse(
    actor: Actor,
    empty: DiscoveryAnswer,
    flags: string[],
    req: RequestContext,
  ): Promise<DiscoveryAnswer> {
    return this.finish(
      actor,
      {
        ...empty,
        status: 'refused',
        refusal: { code: 'prohibited_request', document: PROHIBITED_REQUESTS_DOCUMENT },
      },
      req,
      // Which rule, and which version of the rules, for whoever reviews it. Not for the caller:
      // naming the rule that fired is a map of how to word around it.
      `, rules ${RULESET_VERSION}: ${flags.join(', ')}`,
    );
  }

  /** References and counts, never content (`audit-logging`): not the request, not the results. */
  private async finish(
    actor: Actor,
    answer: DiscoveryAnswer,
    req: RequestContext,
    detail = '',
  ): Promise<DiscoveryAnswer> {
    const outcome =
      answer.status === 'clarification'
        ? `clarification: ${answer.clarification!.code}`
        : answer.status === 'results'
          ? `results: ${answer.results.length}`
          : answer.status;
    await this.audit.record({
      correlationId: req.correlationId,
      actorId: actor.userId,
      action: 'assistant.discovery_answered',
      resourceType: 'investigator_profile',
      reason: `${outcome}${detail} (${this.model!.model}, ${DISCOVERY_PROMPT_VERSION})`,
      ipAddress: req.ip,
      userAgent: req.userAgent,
    });
    return answer;
  }
}

const emptyAnswer = (locale: KnowledgeLocale): DiscoveryAnswer => ({
  status: 'no_results',
  locale,
  searchedFor: null,
  assumptions: [],
  orderedBy: null,
  results: [],
  hasMore: false,
  clarification: null,
  refusal: null,
});
