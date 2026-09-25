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

/** A turn that was let through, ready to be answered. Only this service makes one. */
export interface Turn {
  readonly sessionId: string;
  readonly question: string;
  readonly admitted: Admitted;
  /** Sent before any answering starts: the stored question, and the session it may have named. */
  readonly opening: readonly TurnEvent[];
}

/**
 * One exchange with the assistant, recorded in the caller's session (T-056).
 *
 * ```
 * session (own) → admitted (live, workspace, model, allowance) → question stored → steps
 *   → answer (T-017, citations checked) → reply stored → done
 * ```
 *
 * Refusals come first and store nothing: a stranger's session, a missing model, a spent
 * allowance. Once the question is stored it stays, whatever happens next — a failure or a Stop
 * leaves it as the last message, and {@link retry} answers it. A reply is stored only once the
 * answer is complete and nobody has stopped it, so a conversation never holds half an answer.
 *
 * The only capability wired today is knowledge answering. Each question is answered on its own:
 * earlier turns do not reach the model until the Context Builder (T-046) decides what may.
 */
@Injectable()
export class AssistantTurnService {
  private readonly logger = new Logger(AssistantTurnService.name);

  constructor(
    private readonly sessions: AiSessionsService,
    private readonly knowledge: KnowledgeAnswerService,
  ) {}

  /** A new question: checked, then stored, then ready to answer. */
  async ask(
    actor: Actor,
    sessionId: string,
    input: { content: string; locale?: KnowledgeLocale | undefined },
    req: RequestContext,
  ): Promise<Turn> {
    // The session first: a stranger's id is a 404, and spends none of anyone's allowance.
    await this.sessions.open(actor, sessionId, req);
    const admitted = await this.knowledge.admit(actor, input.locale, req);
    const message = await this.sessions.append(
      actor,
      sessionId,
      { role: 'USER', content: input.content },
      req,
    );
    const session = await this.sessions.open(actor, sessionId, req);
    return {
      sessionId,
      question: input.content,
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
    const admitted = await this.knowledge.admit(actor, input.locale, req);
    return { sessionId, question: last.content, admitted, opening: [] };
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
      const answer = await this.knowledge.respond(actor, turn.question, turn.admitted, req, {
        onStep: (step) => emit({ type: 'step', step }),
        signal,
      });
      if (signal.aborted) return;
      const metadata: KnowledgeReplyMetadata = {
        source: 'knowledge',
        status: answer.status,
        citations: answer.citations,
        locale: answer.locale,
        fallback: answer.fallback,
      };
      const message = await this.sessions.append(
        actor,
        turn.sessionId,
        // "I don't have that" has no words of its own: the client says it, in the reader's
        // language, from `status`.
        { role: 'ASSISTANT', content: answer.answer ?? '', metadata: { ...metadata } },
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
