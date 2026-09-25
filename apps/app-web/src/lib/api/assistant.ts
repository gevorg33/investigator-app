import { ApiError, toApiError } from './errors';
import { workspaceHeader } from './workspace';

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

/** How far answering has got (T-056, T-059). */
export type TurnStep =
  | { step: 'understanding' }
  | { step: 'finding' }
  | { step: 'searching' }
  | { step: 'writing'; sources: number };

/** What a turn's stream carries, in order (`AssistantTurnController`). */
export type TurnEvent =
  | { type: 'message'; message: AiMessage }
  | { type: 'session'; session: AiSession }
  | { type: 'step'; step: TurnStep }
  | { type: 'error'; error: { code: string; messageKey: string; correlationId: string | null } }
  | { type: 'done' };

/** A conversation a search found, and the first message that matched (null: the name did). */
export type SessionMatch = AiSession & { firstMatchSequence: number | null };

/** How many conversations a page of the list holds. */
export const SESSIONS_PAGE = 20;
/** How many messages a conversation opens with, and each "earlier" adds (T-057). */
export const MESSAGES_PAGE = 30;

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

/** A taxonomy node as a result names it: its id, and its label in the reader's language. */
export interface NodeLabel {
  id: string;
  label: string | null;
}

export interface Place {
  countryCode?: string;
  region?: string;
  city?: string;
}

/** A weekly window: 0 = Monday, minutes from midnight. */
export interface Window {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}

/** One reason an investigator matches, as data to phrase (`discovery-explanation.ts`). */
export type MatchReason =
  | { code: 'matched.specialty'; specialties: NodeLabel[] }
  | { code: 'matched.languages'; languages: string[] }
  | { code: 'matched.place'; place: Place }
  | { code: 'matched.distance'; km: number }
  | { code: 'matched.availability'; window: Window }
  | { code: 'not_matched.specialty'; specialties: NodeLabel[] };

/** One investigator a search found: the public projection — no price, no bio, no contact. */
export interface InvestigatorMatch {
  investigatorId: string;
  displayName: string | null;
  headline: string | null;
  yearsExperience: number | null;
  verificationStatus: 'VERIFIED';
  languages: Array<{ code: string; proficiency: string }>;
  specialties: NodeLabel[];
  availability: Window[];
  distanceKm: number | null;
  explanation: MatchReason[];
}

export type Clarification =
  { code: 'purpose' } | { code: 'location' } | { code: 'specialty'; options: NodeLabel[] };

/** What discovery answered (T-018), stored whole on the reply (T-059). */
export interface DiscoveryAnswer {
  status: 'results' | 'no_results' | 'clarification' | 'refused';
  searchedFor: {
    place: Place | null;
    near: boolean;
    radiusKm: number | null;
    specialties: NodeLabel[];
    languages: string[];
    availability: Window | null;
  } | null;
  assumptions: Array<'location.anywhere'>;
  orderedBy: 'distance' | 'relevance' | 'experience' | null;
  results: InvestigatorMatch[];
  hasMore: boolean;
  clarification: Clarification | null;
  refusal: { code: 'prohibited_request'; document: string } | null;
}

export const discoveryReply = (m: AiMessage): DiscoveryAnswer | null =>
  m.metadata['source'] === 'discovery' ? (m.metadata['answer'] as DiscoveryAnswer) : null;

/**
 * What a turn sends: a question, or — `clarifies` — an answer to the question discovery asked:
 * the specialty picked, or where the person is (used for that search only, never stored).
 */
export interface Ask {
  content: string;
  clarifies?: true;
  taxonomyNodeIds?: string[];
  near?: { lon: number; lat: number };
  radiusKm?: number;
}

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
    ...workspaceHeader(),
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
    // A delete answers 204, with nothing to read.
    return (res.status === 204 ? null : await res.json()) as T;
  };

  return {
    /** The most recent current conversation, if any. */
    latest: async (): Promise<AiSession | null> =>
      (await call<Page<AiSession>>('/ai/sessions?limit=1')).items[0] ?? null,
    create: () => call<AiSession>('/ai/sessions', 'POST', {}),
    /** The caller's conversations in this workspace, current or archived, most recent first. */
    list: (archived: boolean, cursor?: string) =>
      call<Page<AiSession>>(
        `/ai/sessions?archived=${archived}&limit=${SESSIONS_PAGE}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      ),
    /** Conversations whose name or messages match, best first, with where the first match is. */
    search: (q: string) => call<SessionMatch[]>(`/ai/sessions/search?q=${encodeURIComponent(q)}`),
    open: (id: string) => call<AiSession>(`/ai/sessions/${id}`),
    /**
     * A page of a conversation from its end backwards (T-057): the newest `MESSAGES_PAGE`
     * messages, or those before where the last page left off — returned in reading order.
     */
    page: async (
      id: string,
      cursor?: string,
    ): Promise<{ items: AiMessage[]; earlier: string | null }> => {
      const page = await call<Page<AiMessage>>(
        `/ai/sessions/${id}/messages?order=newest&limit=${MESSAGES_PAGE}${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      return { items: [...page.items].reverse(), earlier: page.pageInfo.nextCursor };
    },
    rename: (id: string, title: string) =>
      call<AiSession>(`/ai/sessions/${id}`, 'PATCH', { title }),
    archive: (id: string) => call<AiSession>(`/ai/sessions/${id}/archive`, 'POST', {}),
    /** Out of the archive, and active from now. */
    restore: (id: string) => call<AiSession>(`/ai/sessions/${id}/resume`, 'POST', {}),
    remove: (id: string) => call<null>(`/ai/sessions/${id}`, 'DELETE'),
    workspaces: () => call<Workspace[]>('/workspaces'),

    /**
     * A turn: `ask` sends a new question, `retry` answers the one left unanswered. Resolves when
     * the stream ends; rejects with an `ApiError` when the turn was refused before it started, and
     * with the signal's reason when stopped.
     */
    turn: async (
      sessionId: string,
      input: { retry: true } | Ask,
      onEvent: (event: TurnEvent) => void,
      signal: AbortSignal,
    ): Promise<void> => {
      const retry = 'retry' in input;
      const res = await fetch(`/api/v1/ai/sessions/${sessionId}/turns${retry ? '/retry' : ''}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { ...headers(true), accept: 'text/event-stream' },
        body: JSON.stringify(retry ? {} : input),
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
