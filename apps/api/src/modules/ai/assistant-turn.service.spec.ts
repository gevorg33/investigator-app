import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testPool } from '../../../test/db';
import { HashingEmbedder } from '../../../test/hashing-embedder';
import { asRequests, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import { PlatformContext } from '../../common/context/platform-context';
import { ProviderError } from '../../common/errors/provider-error';
import { AiSessionsService } from '../ai-sessions/ai-sessions.service';
import {
  MemoryRateLimitStore,
  RateLimitService,
  type RateLimitStore,
} from '../auth/rate-limit.service';
import { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service';
import { parseDocument } from '../knowledge/knowledge-source';
import { KnowledgeSyncService } from '../knowledge/knowledge-sync.service';
import { AssistantTurnService, type TurnEvent } from './assistant-turn.service';
import type { ChatModel, ChatPrompt } from './chat-model';
import { KnowledgeAnswerService } from './knowledge-answer.service';

const DOC = parseDocument(
  'docs/knowledge-base/customer/kb-t-quotes.en.md',
  [
    '---',
    'id: kb-t-quotes',
    'title: Quotes',
    'audience: customer',
    'visibility: authenticated',
    'locale: en',
    'version: 1',
    'status: current',
    'updated: 2026-09-25',
    'source_of_truth: docs',
    '---',
    '',
    '## How long does a quotation stay valid?',
    '',
    'A quotation expires after the validity period its investigator set.',
    '',
  ].join('\n'),
)!;

const QUESTION = 'How long does a quotation stay valid?';
const citing = (answer: string | null) => JSON.stringify({ answer, sources: answer ? ['S1'] : [] });

/** A model that answers as the test says, and can be held until the test lets it go. */
class FakeModel implements ChatModel {
  readonly model = 'fake-model';
  readonly prompts: ChatPrompt[] = [];
  constructor(private readonly reply: (signal?: AbortSignal) => string | Promise<string>) {}
  async complete(prompt: ChatPrompt, signal?: AbortSignal): Promise<string> {
    this.prompts.push(prompt);
    return this.reply(signal);
  }
}

describe('a turn in a conversation (T-056)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(async () => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    await new KnowledgeSyncService(db, new PlatformContext(audit), audit).sync(
      [DOC],
      new HashingEmbedder(),
      { correlationId: randomUUID() },
    );
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const build = (model: ChatModel | null, store: RateLimitStore = new MemoryRateLimitStore()) => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    const sessions = asRequests(new AiSessionsService(db, authz, audit), owner);
    const knowledge = new KnowledgeAnswerService(
      db,
      authz,
      audit,
      new RateLimitService(store),
      new KnowledgeRetrievalService(db, new HashingEmbedder()),
      model,
    );
    return { sessions, turns: asRequests(new AssistantTurnService(sessions, knowledge), owner) };
  };
  const req = () => ({ correlationId: randomUUID(), ip: '203.0.113.56', userAgent: 'spec' });
  const customer = async (): Promise<Actor> => (await member(owner, { roles: ['CUSTOMER'] })).actor;

  /** Runs a turn to the end, collecting what a client would have been sent. */
  const follow = async (
    turns: AssistantTurnService,
    actor: Actor,
    turn: Awaited<ReturnType<AssistantTurnService['ask']>>,
    signal = new AbortController().signal,
    r = req(),
  ): Promise<TurnEvent[]> => {
    const events: TurnEvent[] = [...turn.opening];
    await turns.run(actor, turn, r, (e) => events.push(e), signal);
    return events;
  };
  const history = async (sessions: AiSessionsService, actor: Actor, id: string) =>
    (await sessions.messages(actor, id, {}, req())).items;

  it('stores the question, names the session from it, and stores the checked reply with its sources', async () => {
    const { sessions, turns } = build(
      new FakeModel(() => citing('Until its validity period ends.')),
    );
    const me = await customer();
    const session = await sessions.create(me, {}, req());

    const events = await follow(
      turns,
      me,
      await turns.ask(me, session.id, { content: QUESTION }, req()),
    );

    expect(events.map((e) => e.type)).toEqual(['message', 'session', 'step', 'step', 'message']);
    expect(events[0]).toMatchObject({ message: { role: 'USER', content: QUESTION, sequence: 1 } });
    expect(events[1]).toMatchObject({ session: { id: session.id, title: QUESTION } });
    expect(events.slice(2, 4)).toEqual([
      { type: 'step', step: { step: 'searching' } },
      { type: 'step', step: { step: 'writing', sources: 1 } },
    ]);
    const reply = {
      role: 'ASSISTANT',
      kind: 'TEXT',
      sequence: 2,
      content: 'Until its validity period ends.',
      metadata: {
        source: 'knowledge',
        status: 'answered',
        citations: [
          {
            docKey: 'kb-t-quotes',
            version: 1,
            title: 'Quotes',
            section: 'How long does a quotation stay valid?',
            locale: 'en',
          },
        ],
        locale: 'en',
        fallback: false,
      },
    };
    expect(events[4]).toMatchObject({ message: reply });
    expect(await history(sessions, me, session.id)).toMatchObject([
      { role: 'USER', content: QUESTION },
      reply,
    ]);
  });

  it('records "I don’t have that" as a reply with no words, for the client to say in its language', async () => {
    const model = new FakeModel(() => citing(null));
    const { sessions, turns } = build(model);
    const me = await customer();
    const session = await sessions.create(me, {}, req());
    const events = await follow(
      turns,
      me,
      await turns.ask(me, session.id, { content: 'zzzz qqqq xxxx' }, req()),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'message',
      message: { role: 'ASSISTANT', content: '', metadata: { status: 'no_answer', citations: [] } },
    });
    expect(model.prompts).toEqual([]);
  });

  describe('refusals store nothing', () => {
    it('refuses while no model is configured — the question is not kept, and no allowance is spent', async () => {
      let counted = 0;
      const { sessions, turns } = build(null, { incr: async () => ++counted });
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      await expect(turns.ask(me, session.id, { content: QUESTION }, req())).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(await history(sessions, me, session.id)).toEqual([]);
      expect((await sessions.open(me, session.id, req())).title).toBeNull();
      expect(counted).toBe(0);
    });

    it('refuses a spent allowance before storing', async () => {
      const { sessions, turns } = build(new FakeModel(() => citing(null)), {
        incr: async () => 61,
      });
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      await expect(turns.ask(me, session.id, { content: QUESTION }, req())).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      expect(await history(sessions, me, session.id)).toEqual([]);
    });

    it('answers someone else’s session as one that does not exist, spending none of their allowance', async () => {
      let counted = 0;
      const { sessions, turns } = build(new FakeModel(() => citing(null)), {
        incr: async () => ++counted,
      });
      const mine = await customer();
      const stranger = await customer();
      const session = await sessions.create(mine, {}, req());
      await sessions.append(mine, session.id, { role: 'USER', content: 'Mine' }, req());
      for (const attempt of [
        () => turns.ask(stranger, session.id, { content: QUESTION }, req()),
        () => turns.retry(stranger, session.id, {}, req()),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ code: 'NOT_FOUND' });
      }
      expect(counted).toBe(0);
      expect(await history(sessions, mine, session.id)).toHaveLength(1);
    });
  });

  describe('failing, stopping and trying again', () => {
    it('keeps the question when answering fails, says why, and answers it on retry', async () => {
      let down = true;
      const model = new FakeModel(() => {
        if (down) throw new ProviderError('chat request failed: HTTP 502');
        return citing('Until its validity period ends.');
      });
      const { sessions, turns } = build(model);
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      const r = req();

      const failed = await follow(
        turns,
        me,
        await turns.ask(me, session.id, { content: QUESTION }, r),
        undefined,
        r,
      );
      expect(failed.at(-1)).toEqual({
        type: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          messageKey: 'error.common.service_unavailable',
          correlationId: r.correlationId,
        },
      });
      expect((await history(sessions, me, session.id)).map((m) => m.role)).toEqual(['USER']);

      down = false;
      const retried = await follow(turns, me, await turns.retry(me, session.id, {}, req()));
      // No second copy of the question: a retry answers the one already there.
      expect(retried.map((e) => e.type)).toEqual(['step', 'step', 'message']);
      expect((await history(sessions, me, session.id)).map((m) => [m.role, m.content])).toEqual([
        ['USER', QUESTION],
        ['ASSISTANT', 'Until its validity period ends.'],
      ]);
      expect(model.prompts.at(-1)?.user).toContain(QUESTION);
    });

    it('reports no reference when the request carried none, rather than inventing one', async () => {
      const { sessions, turns } = build(
        new FakeModel(() => {
          throw new ProviderError('chat request failed: HTTP 502');
        }),
      );
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      const bare = { ip: '203.0.113.56' };
      const events = await follow(
        turns,
        me,
        await turns.ask(me, session.id, { content: QUESTION }, bare),
        undefined,
        bare,
      );
      expect(events.at(-1)).toMatchObject({ type: 'error', error: { correlationId: null } });
    });

    it('stores nothing more once stopped, and tells the client nothing more', async () => {
      const stop = new AbortController();
      const model = new FakeModel(async (signal) => {
        stop.abort();
        signal!.throwIfAborted();
        return citing('Never read.');
      });
      const { sessions, turns } = build(model);
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      const events = await follow(
        turns,
        me,
        await turns.ask(me, session.id, { content: QUESTION }, req()),
        stop.signal,
      );
      expect(events.map((e) => e.type)).toEqual(['message', 'session', 'step', 'step']);
      expect((await history(sessions, me, session.id)).map((m) => m.role)).toEqual(['USER']);
    });

    it('does not store an answer that arrives after Stop', async () => {
      const stop = new AbortController();
      // A model that ignores the signal and answers anyway.
      const model = new FakeModel(() => {
        stop.abort();
        return citing('Arrived too late.');
      });
      const { sessions, turns } = build(model);
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      const events = await follow(
        turns,
        me,
        await turns.ask(me, session.id, { content: QUESTION }, req()),
        stop.signal,
      );
      expect(events.some((e) => e.type === 'message' && e.message.role === 'ASSISTANT')).toBe(
        false,
      );
      expect(await history(sessions, me, session.id)).toHaveLength(1);
    });

    it('refuses to answer twice: a retry needs an unanswered question at the end', async () => {
      const { sessions, turns } = build(new FakeModel(() => citing('Until it ends.')));
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      await expect(turns.retry(me, session.id, {}, req())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
      await follow(turns, me, await turns.ask(me, session.id, { content: QUESTION }, req()));
      await expect(turns.retry(me, session.id, {}, req())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
    });

    it('reports a failure that is not the provider’s as internal, and logs which kind — never what was asked', async () => {
      const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const broken = new FakeModel(() => {
        throw new TypeError(`cannot read ${QUESTION}`);
      });
      const { sessions, turns } = build(broken);
      const me = await customer();
      const session = await sessions.create(me, {}, req());
      const r = req();
      const events = await follow(
        turns,
        me,
        await turns.ask(me, session.id, { content: QUESTION }, r),
        undefined,
        r,
      );
      expect(events.at(-1)).toMatchObject({
        type: 'error',
        error: { code: 'INTERNAL_ERROR', messageKey: 'error.common.internal' },
      });
      expect(logged).toHaveBeenCalledWith(
        { failure: 'TypeError', correlationId: r.correlationId },
        'assistant turn failed',
      );
      expect(JSON.stringify(logged.mock.calls)).not.toContain('quotation');

      logged.mockClear();
      const odd = new FakeModel(() => {
        throw 'a string, not an Error';
      });
      const { turns: oddTurns } = build(odd);
      await follow(oddTurns, me, await oddTurns.retry(me, session.id, {}, r), undefined, r);
      expect(logged).toHaveBeenCalledWith(
        { failure: 'string', correlationId: r.correlationId },
        'assistant turn failed',
      );
      logged.mockRestore();
    });
  });
});
