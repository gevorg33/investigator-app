import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService, type AuthzContext } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { currentContext } from '../../common/context/execution-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { ProviderError } from '../../common/errors/provider-error';
import type { RequestContext } from '../../common/http/request-context';
import { DB, type Db } from '../../database/database.module';
import { KNOWLEDGE_LOCALES, users, type KnowledgeLocale } from '../../database/schema';
import { RateLimitService } from '../auth/rate-limit.service';
import { knowledgeReader } from '../knowledge/knowledge-reader';
import {
  KnowledgeRetrievalService,
  type RetrievedChunk,
} from '../knowledge/knowledge-retrieval.service';
import { CHAT_MODEL, type ChatModel } from './chat-model';
import { KNOWLEDGE_PROMPT_VERSION, knowledgePrompt, parseAnswer } from './knowledge-answer.prompt';

/** A source an answer used: enough for the reader to find it, and for support to find the text. */
export interface Citation {
  docKey: string;
  version: number;
  title: string;
  section: string;
  locale: string;
}

export interface KnowledgeAnswer {
  /** `no_answer` is an answer: the knowledge base does not say, and the client says so. */
  status: 'answered' | 'no_answer';
  answer: string | null;
  citations: Citation[];
  /** The language the answer is written in. */
  locale: KnowledgeLocale;
  /** True when a cited source is in English because it has no version in `locale`. */
  fallback: boolean;
}

/**
 * Answers a question about how the platform works from the knowledge base (T-017).
 *
 * ```
 * actor → workspace → reader → retrieve (authorized) → prompt → model → validate → audit
 * ```
 *
 * Nothing retrieved means no model call and `no_answer`: an answer with no source would be the
 * model's own knowledge, which is exactly what this assistant may not use (non-negotiable 7).
 * A reply that cites nothing, or cites a source it was not given, is also `no_answer`.
 *
 * Stateless: the question is not stored. The audit row records that a question was answered,
 * from which documents, by which model and instructions — never the question or the answer.
 */
@Injectable()
export class KnowledgeAnswerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
    private readonly limits: RateLimitService,
    private readonly retrieval: KnowledgeRetrievalService,
    @Inject(CHAT_MODEL) private readonly model: ChatModel | null,
  ) {}

  async answer(
    actor: Actor,
    input: { question: string; locale?: KnowledgeLocale | undefined },
    req: RequestContext,
  ): Promise<KnowledgeAnswer> {
    const c: AuthzContext = {
      action: 'assistant.knowledge_answer',
      resourceType: 'knowledge',
      correlationId: req.correlationId,
      ipAddress: req.ip,
    };
    await this.authz.requireActive(actor, c);
    const context = currentContext();
    await this.authz.requireWorkspace(actor, context !== undefined, c);
    // Before the rate limit: an unconfigured assistant should not spend anyone's allowance.
    if (this.model === null) throw new AppError(ErrorCode.SERVICE_UNAVAILABLE);
    await this.limits.consume('assistantQuestionPerAccount', actor.userId);

    const locale = input.locale ?? (await this.localeOf(actor.userId));
    const reader = knowledgeReader(actor, context!);
    try {
      const found = await this.retrieval.retrieve(reader, input.question, locale);
      if (found.chunks.length === 0) return await this.noAnswer(actor, locale, 'no_sources', req);

      const prompt = knowledgePrompt(input.question, found.chunks, locale);
      const reply = parseAnswer(await this.model.complete(prompt), prompt.sources);
      if (reply === null) return await this.noAnswer(actor, locale, 'unsupported', req);

      await this.record(actor, `answered: ${reply.cited.map(ref).join(', ')}`, req);
      return {
        status: 'answered',
        answer: reply.answer,
        citations: reply.cited.map(citation),
        locale,
        fallback: reply.cited.some((chunk) => chunk.locale !== locale),
      };
    } catch (e) {
      // A provider that is down is a 503 the client can retry, not our 500.
      if (e instanceof ProviderError) throw new AppError(ErrorCode.SERVICE_UNAVAILABLE);
      throw e;
    }
  }

  /** The locale the user chose, read now rather than trusted from anything older. */
  private async localeOf(userId: string): Promise<KnowledgeLocale> {
    const rows = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    // A saved language the knowledge base is not written in answers in English.
    const known = rows
      .map((r) => r.locale)
      .find((l): l is KnowledgeLocale => (KNOWLEDGE_LOCALES as readonly string[]).includes(l));
    return known ?? 'en';
  }

  private async noAnswer(
    actor: Actor,
    locale: KnowledgeLocale,
    why: 'no_sources' | 'unsupported',
    req: RequestContext,
  ): Promise<KnowledgeAnswer> {
    await this.record(actor, `no_answer: ${why}`, req);
    return { status: 'no_answer', answer: null, citations: [], locale, fallback: false };
  }

  /** References, never content (`audit-logging`): which documents, which model, which instructions. */
  private async record(actor: Actor, outcome: string, req: RequestContext): Promise<void> {
    await this.audit.record({
      correlationId: req.correlationId,
      actorId: actor.userId,
      action: 'assistant.knowledge_answered',
      resourceType: 'knowledge',
      reason: `${outcome} (${this.model!.model}, ${KNOWLEDGE_PROMPT_VERSION})`,
      ipAddress: req.ip,
      userAgent: req.userAgent,
    });
  }
}

const ref = (c: RetrievedChunk): string => `${c.locale}/${c.docKey}@${c.version}`;

const citation = (c: RetrievedChunk): Citation => ({
  docKey: c.docKey,
  version: c.version,
  title: c.title,
  section: c.heading,
  locale: c.locale,
});
