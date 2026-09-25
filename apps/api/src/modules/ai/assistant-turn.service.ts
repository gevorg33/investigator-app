import { Injectable, Logger } from '@nestjs/common';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode, ERROR_MESSAGE_KEY, type ErrorCodeValue } from '../../common/errors/error-codes';
import type { RequestContext } from '../../common/http/request-context';
import type { KnowledgeLocale } from '../../database/schema';
import {
  AiSessionsService,
  type MessageView,
  type SessionView,
} from '../ai-sessions/ai-sessions.service';
import {
  DiscoveryAnswerService,
  type Clarification,
  type DiscoveryAnswer,
  type DiscoveryRequest,
} from './discovery/discovery-answer.service';
import {
  KnowledgeAnswerService,
  type Admitted,
  type AnswerStep,
  type KnowledgeAnswer,
} from './knowledge-answer.service';

/**
 * What a client is told while a turn happens, in order (T-056): the user's message as stored and
 * the session it named, each stage as it starts, the assistant's reply as stored, and `done` — or
 * an `error` in place of the reply. Nothing is sent that is not true yet: the reply arrives whole,
 * after its citations were checked, never as unchecked words.
 */
export type TurnEvent =
  | { type: 'message'; message: MessageView }
  | { type: 'session'; session: SessionView }
  | { type: 'step'; step: AnswerStep }
  | {
      type: 'error';
      error: { code: ErrorCodeValue; messageKey: string; correlationId: string | null };
    }
  | { type: 'done' };

/** The metadata an assistant reply is stored with: what a client needs to render it again. */
export interface KnowledgeReplyMetadata {
  source: 'knowledge';
  status: KnowledgeAnswer['status'];
  citations: KnowledgeAnswer['citations'];
  locale: KnowledgeAnswer['locale'];
  fallback: boolean;
}

/** The metadata a discovery reply is stored with: the whole structured answer, to render again. */
export interface DiscoveryReplyMetadata {
  source: 'discovery';
  answer: DiscoveryAnswer;
}

/**
 * How a person answered the question discovery asked (T-059): the specialty they picked, or where
 * they are. With `clarifies`, the turn's words answer that question rather than ask a new one.
 */
export interface ClarificationInput {
  clarifies?: boolean | undefined;
  taxonomyNodeIds?: string[] | undefined;
  /** Used for this search and never stored — not in the message, not in the reply. */
  near?: { lon: number; lat: number } | undefined;
  radiusKm?: number | undefined;
}

/** The statuses discovery answers itself; for the rest, the knowledge base does (T-059). */
const DISCOVERY_REPLIES: ReadonlySet<DiscoveryAnswer['status']> = new Set([
  'results',
  'no_results',
  'clarification',
  'refused',
]);

/** A turn that was let through, ready to be answered. Only this service makes one. */
export interface Turn {
  readonly sessionId: string;
  /** The person's words, as stored: what the knowledge base answers when this is not a search. */
  readonly question: string;
  /** What discovery is asked: the question, or the one a clarification answers, with the answer. */
  readonly discovery: DiscoveryRequest;
  readonly admitted: Admitted;
  /** Sent before any answering starts: the stored question, and the session it may have named. */
  readonly opening: readonly TurnEvent[];
}

/**
 * One exchange with the assistant, recorded in the caller's session (T-056, T-059).
 *
 * ```
 * session (own) → admitted (live, workspace, model, allowance) → question stored → steps
 *   → discovery (T-018) — a search, a question back, or a refusal: stored as it is
 *   → otherwise the knowledge base (T-017, citations checked) → reply stored → done
 * ```
 *
 * **Discovery first** (owner decision, 2026-09-25): every question goes to discovery, which says
 * whether it is a search for someone. When it is not — or cannot be made into one — the knowledge
 * base answers. The lawful-use rules screen the words before either model sees them; a request
 * they match is refused, with the policy to read. A discovery answer is stored whole, as
 * structured data the client renders — the model writes none of it (T-018).
 *
 * Refusals come first and store nothing: a stranger's session, a missing model, a spent
 * allowance. Once the question is stored it stays, whatever happens next — a failure or a Stop
 * leaves it as the last message, and {@link retry} answers it. A reply is stored only once the
 * answer is complete and nobody has stopped it, so a conversation never holds half an answer.
 *
 * Each question is answered on its own: earlier turns do not reach the model until the Context
 * Builder (T-046) decides what may. The one exception is discovery's own question — which
 * specialty, where, what for — whose answer is paired with the question it was asked about.
 */
@Injectable()
export class AssistantTurnService {
  private readonly logger = new Logger(AssistantTurnService.name);

  constructor(
    private readonly sessions: AiSessionsService,
    private readonly knowledge: KnowledgeAnswerService,
    private readonly discovery: DiscoveryAnswerService,
  ) {}

  /** A new question — or an answer to discovery's: checked, then stored, then ready to answer. */
  async ask(
    actor: Actor,
    sessionId: string,
    input: { content: string; locale?: KnowledgeLocale | undefined } & ClarificationInput,
    req: RequestContext,
  ): Promise<Turn> {
    // The session first: a stranger's id is a 404, and spends none of anyone's allowance.
    await this.sessions.open(actor, sessionId, req);
    const { request, metadata } = await this.request(actor, sessionId, input, req);
    const admitted = await this.knowledge.admit(actor, input.locale, req);
    const message = await this.sessions.append(
      actor,
      sessionId,
      { role: 'USER', content: input.content, metadata },
      req,
    );
    const session = await this.sessions.open(actor, sessionId, req);
    return {
      sessionId,
      question: input.content,
      discovery: request,
      admitted,
      opening: [
        { type: 'message', message },
        { type: 'session', session },
      ],
    };
  }

  /**
   * Answers the question a turn left unanswered — failed, or stopped. Only when the last message
   * is the user's: anything else has its answer already, and a second one would be a conflict.
   */
  async retry(
    actor: Actor,
    sessionId: string,
    input: { locale?: KnowledgeLocale | undefined },
    req: RequestContext,
  ): Promise<Turn> {
    const last = await this.sessions.last(actor, sessionId, req);
    if (last?.role !== 'USER' || last.content === null) throw AppError.stateConflict();
    // An unanswered answer to discovery's question is paired again with what it answers — with the
    // specialty it picked, but not a location, which was never stored: discovery asks again.
    const stored = last.metadata['taxonomyNodeIds'];
    const { request } = await this.request(
      actor,
      sessionId,
      {
        content: last.content,
        clarifies: last.metadata['clarifies'] !== undefined,
        taxonomyNodeIds: Array.isArray(stored) ? (stored as string[]) : undefined,
      },
      req,
      1,
    );
    const admitted = await this.knowledge.admit(actor, input.locale, req);
    return { sessionId, question: last.content, discovery: request, admitted, opening: [] };
  }

  /**
   * What discovery is asked, and what the person's message is stored with. A plain question is
   * asked as it is. An answer to discovery's question is paired with the question it answers — the
   * person's message before discovery's — and checked against what was asked: a specialty must be
   * one of those offered. `skip` steps over messages already at the end (a retry's own).
   */
  private async request(
    actor: Actor,
    sessionId: string,
    input: { content: string } & ClarificationInput,
    req: RequestContext,
    skip = 0,
  ): Promise<{ request: DiscoveryRequest; metadata: Record<string, unknown> }> {
    if (!input.clarifies) {
      if (input.taxonomyNodeIds !== undefined || input.near !== undefined) {
        throw AppError.validation([
          { field: 'clarifies', code: 'REQUIRED', messageKey: 'error.common.validation_failed' },
        ]);
      }
      return { request: { question: input.content }, metadata: {} };
    }
    const recent = await this.sessions.messages(
      actor,
      sessionId,
      { order: 'newest', limit: skip + 2 },
      req,
    );
    const [reply, question] = recent.items.slice(skip);
    const asked = clarificationOf(reply);
    if (asked === null || question?.role !== 'USER' || question.content === null) {
      throw AppError.stateConflict();
    }
    return answerTo(asked, question.content, input);
  }

  /**
   * Answers the turn, telling `emit` as it goes. Never throws: once a client is listening, a
   * failure is an `error` event it can show and retry. After `signal` aborts, nothing more is
   * emitted or stored.
   */
  async run(
    actor: Actor,
    turn: Turn,
    req: RequestContext,
    emit: (event: TurnEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      const options = { onStep: (step: AnswerStep) => emit({ type: 'step', step }), signal };
      const found = await this.discovery.respond(
        actor,
        turn.discovery,
        turn.admitted.locale,
        req,
        options,
      );
      if (signal.aborted) return;
      let reply: { content: string; metadata: KnowledgeReplyMetadata | DiscoveryReplyMetadata };
      if (DISCOVERY_REPLIES.has(found.status)) {
        // Structured, whole: the client renders it; nothing in it is the model's own wording.
        reply = { content: '', metadata: { source: 'discovery', answer: found } };
      } else {
        const answer = await this.knowledge.respond(actor, turn.question, turn.admitted, req, options);
        if (signal.aborted) return;
        reply = {
          // "I don't have that" has no words of its own: the client says it, in the reader's
          // language, from `status`.
          content: answer.answer ?? '',
          metadata: {
            source: 'knowledge',
            status: answer.status,
            citations: answer.citations,
            locale: answer.locale,
            fallback: answer.fallback,
          },
        };
      }
      const message = await this.sessions.append(
        actor,
        turn.sessionId,
        { role: 'ASSISTANT', content: reply.content, metadata: { ...reply.metadata } },
        req,
      );
      emit({ type: 'message', message });
    } catch (e) {
      if (signal.aborted) return;
      emit({ type: 'error', error: this.describe(e, req) });
    }
  }

  /** An error as the client may see it: its code and key, never its text or stack. */
  private describe(
    e: unknown,
    req: RequestContext,
  ): Extract<TurnEvent, { type: 'error' }>['error'] {
    let code: ErrorCodeValue = ErrorCode.INTERNAL_ERROR;
    if (e instanceof AppError) code = e.code;
    // Which kind of failure, against the correlation id — never its message: a database error's
    // detail can quote the row, and the row is the user's question (docs/architecture/logging.md).
    else
      this.logger.error(
        { failure: e instanceof Error ? e.name : typeof e, correlationId: req.correlationId },
        'assistant turn failed',
      );
    return {
      code,
      messageKey: ERROR_MESSAGE_KEY[code],
      correlationId: req.correlationId ?? null,
    };
  }
}

/** The question discovery asked in `reply`, if that is what it is. */
function clarificationOf(reply: MessageView | undefined): Clarification | null {
  const meta = reply?.metadata as Partial<DiscoveryReplyMetadata> | undefined;
  if (reply?.role !== 'ASSISTANT' || meta?.source !== 'discovery') return null;
  // A discovery reply always carries its answer: that is what it is stored for.
  return meta.answer!.status === 'clarification' ? meta.answer!.clarification : null;
}

/**
 * A person's answer to discovery's question, as a request: what it is for (their words), which
 * specialty (one of those offered), or where (a point, or a place in their words).
 */
function answerTo(
  asked: Clarification,
  question: string,
  input: { content: string } & ClarificationInput,
): { request: DiscoveryRequest; metadata: Record<string, unknown> } {
  switch (asked.code) {
    case 'purpose':
      return {
        request: { question, purpose: input.content },
        metadata: { clarifies: 'purpose' },
      };
    case 'specialty': {
      const offered = new Set(asked.options.map((o) => o.id));
      const picked = input.taxonomyNodeIds ?? [];
      if (picked.length === 0 || picked.some((id) => !offered.has(id))) {
        throw AppError.validation([
          {
            field: 'taxonomyNodeIds',
            code: 'NOT_OFFERED',
            messageKey: 'error.common.validation_failed',
          },
        ]);
      }
      return {
        request: { question, taxonomyNodeIds: picked },
        metadata: { clarifies: 'specialty', taxonomyNodeIds: picked },
      };
    }
    case 'location':
      return {
        request:
          input.near === undefined
            ? // A place in their own words: read with the question, as if it had said it.
              { question: `${question}\n${input.content}` }
            : { question, near: input.near, radiusKm: input.radiusKm },
        metadata: { clarifies: 'location' },
      };
  }
}
