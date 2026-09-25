import { ApiError, toApiError } from './errors';

/** A conversation with the assistant, as `/ai/sessions` returns it (T-045). */
export interface AiSession {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'IDLE' | 'ARCHIVED' | 'DELETED';
  lastActivityAt: string;
  createdAt: string;
}

/** A source a knowledge answer used (T-017). */
export interface Citation {
  docKey: string;
  version: number;
  title: string;
  section: string;
  locale: string;
}

/** One message in a conversation. Tool calls and results are structured events, never prose. */
export interface AiMessage {
  id: string;
  sequence: number;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM' | 'TOOL';
  kind: 'TEXT' | 'TOOL_CALL' | 'TOOL_RESULT';
  content: string | null;
  event: { tool?: unknown; arguments?: unknown; resultId?: unknown } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** How far answering has got (T-056). */
export type TurnStep = { step: 'searching' } | { step: 'writing'; sources: number };

/** What a turn's stream carries, in order (`AssistantTurnController`). */
export type TurnEvent =
  | { type: 'message'; message: AiMessage }
  | { type: 'session'; session: AiSession }
  | { type: 'step'; step: TurnStep }
  | { type: 'error'; error: { code: string; messageKey: string; correlationId: string | null } }
  | { type: 'done' };

export interface Page<T> {
  items: T[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

/** A workspace the caller can work in (`GET /workspaces`, T-075). */
export interface Workspace {
  id: string;
  kind: 'PERSONAL' | 'AGENCY';
  name: string | null;
  current: boolean;
}

/** A knowledge reply's metadata, when the message is one (`KnowledgeReplyMetadata` in the API). */
export interface KnowledgeReply {
  source: 'knowledge';
  status: 'answered' | 'no_answer';
  citations: Citation[];
  locale: string;
  fallback: boolean;
}

export const knowledgeReply = (m: AiMessage): KnowledgeReply | null =>
  m.metadata['source'] === 'knowledge' ? (m.metadata as unknown as KnowledgeReply) : null;

/**
 * Server-sent events, as they arrive in pieces: each call takes the next piece of text and returns
 * the events it completed. An event ends at a blank line; a piece can end anywhere, even inside a
 * line, and the rest waits for the next piece.
 */
export function sseParser(): (chunk: string) => TurnEvent[] {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, '\n');
    const events: TurnEvent[] = [];
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let type = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trimStart();
      }
      events.push({ type, ...(data === '' ? {} : (JSON.parse(data) as object)) } as TurnEvent);
    }
    return events;
  };
}

/**
 * The assistant's API, from the browser (same-origin `/api`, ADR-0002). `role` is the role the
 * reader chose to act as, sent as `X-Active-Role` so the assistant reads the documentation for
 * that role — the API only ever narrows by it.
 */
export function assistantApi(role: string | null) {
  const headers = (json: boolean): Record<string, string> => ({
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(role === null ? {} : { 'x-active-role': role }),
  });

  const call = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: headers(body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as T;
  };

  return {
    /** The most recent current conversation, if any. */
    latest: async (): Promise<AiSession | null> =>
      (await call<Page<AiSession>>('/ai/sessions?limit=1')).items[0] ?? null,
    create: () => call<AiSession>('/ai/sessions', 'POST', {}),
    /** Every message of a conversation, in order, page after page. */
    messages: async (sessionId: string): Promise<AiMessage[]> => {
      const all: AiMessage[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
        const page: Page<AiMessage> = await call(
          `/ai/sessions/${sessionId}/messages?limit=100${query}`,
        );
        all.push(...page.items);
        cursor = page.pageInfo.nextCursor;
      } while (cursor !== null);
      return all;
    },
    workspaces: () => call<Workspace[]>('/workspaces'),

    /**
     * A turn: `ask` sends a new question, `retry` answers the one left unanswered. Resolves when
     * the stream ends; rejects with an `ApiError` when the turn was refused before it started, and
     * with the signal's reason when stopped.
     */
    turn: async (
      sessionId: string,
      input: { retry: true } | { content: string },
      onEvent: (event: TurnEvent) => void,
      signal: AbortSignal,
    ): Promise<void> => {
      const retry = 'retry' in input;
      const res = await fetch(`/api/v1/ai/sessions/${sessionId}/turns${retry ? '/retry' : ''}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...headers(true), accept: 'text/event-stream' },
        body: JSON.stringify(retry ? {} : { content: input.content }),
        signal,
      });
      if (!res.ok) throw await toApiError(res);
      if (res.body === null) throw new ApiError(0, 'NETWORK', 'error.common.internal');
      const parse = sseParser();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const event of parse(value)) onEvent(event);
      }
    },
  };
}

export type AssistantApi = ReturnType<typeof assistantApi>;
