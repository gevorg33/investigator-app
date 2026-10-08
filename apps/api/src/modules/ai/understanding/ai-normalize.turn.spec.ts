import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { person, TallyTool } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { asRequests, scopedDb } from '../../../../test/workspace-context';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService } from '../../../common/authz/authz.service';
import type { Actor } from '../../../common/authz/contract';
import { PlatformContext } from '../../../common/context/platform-context';
import { AiSessionsService } from '../../ai-sessions/ai-sessions.service';
import { MemoryRateLimitStore, RateLimitService } from '../../auth/rate-limit.service';
import { KnowledgeRetrievalService } from '../../knowledge/knowledge-retrieval.service';
import { SearchService } from '../../search/search.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { HashingEmbedder } from '../../../../test/hashing-embedder';
import { AssistantTurnService, type TurnEvent } from '../assistant-turn.service';
import type { ChatModel, ChatPrompt } from '../chat-model';
import { DiscoveryAnswerService } from '../discovery/discovery-answer.service';
import { KnowledgeAnswerService } from '../knowledge-answer.service';
import { AiPlansService } from '../plans/ai-plans.service';
import { ListTaxonomyTool } from '../tools/discovery/list-taxonomy.tool';
import { SearchInvestigatorsTool } from '../tools/discovery/search-investigators.tool';
import { ToolRunner } from '../tools/tool-runner';
import { MASK } from './credentials';

/** Shaped like an OpenAI key, issued by nobody. Built from parts so no scanner takes it for a leak. */
const KEY = `sk-${'proj-'}${'Z9y8X7w6'.repeat(4)}`;

/** A model that remembers everything it is sent, and answers "not a search", then "not covered". */
class RecordingModel implements ChatModel {
  readonly model = 'recording-model';
  readonly sent: ChatPrompt[] = [];
  async complete(prompt: ChatPrompt): Promise<string> {
    this.sent.push(prompt);
    return prompt.system.startsWith('You turn a request to find a private investigator')
      ? JSON.stringify({
          intent: 'other',
          specialty: { refs: [], ambiguous: false },
          languages: [],
          place: null,
          nearest: false,
          availability: null,
          relevanceHint: null,
          policyConcern: false,
        })
      : JSON.stringify({ answer: null, sources: [] });
  }
}

/**
 * The credential screen and structural routing in a real conversation (T-220): a pasted key is
 * masked before it is stored and reaches no model, no plan step, no audit row and no event; a yes
 * while a plan waits is pointed at it and confirms nothing.
 */
describe('screening and routing a turn (T-220)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });
  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const build = () => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    const counted: string[] = [];
    const limits = new RateLimitService(
      Object.assign(new MemoryRateLimitStore(), {
        incr: async (key: string) => {
          counted.push(key);
          return 1;
        },
      }),
    );
    const model = new RecordingModel();
    const sessions = asRequests(new AiSessionsService(db, authz, audit), owner);
    const knowledge = new KnowledgeAnswerService(
      db,
      authz,
      audit,
      limits,
      new KnowledgeRetrievalService(db, new HashingEmbedder()),
      model,
    );
    const taxonomy = new TaxonomyService(db, authz, new PlatformContext(audit), audit);
    const list = new ListTaxonomyTool(taxonomy);
    const search = new SearchInvestigatorsTool(new SearchService(db, authz), taxonomy);
    const discovery = new DiscoveryAnswerService(
      db,
      authz,
      audit,
      limits,
      new ToolRunner(authz, audit, limits, [list, search]),
      list,
      search,
      model,
    );
    const plans = asRequests(
      new AiPlansService(db, authz, audit, new ToolRunner(authz, audit, limits, [new TallyTool()])),
      owner,
    );
    const turns = asRequests(
      new AssistantTurnService(sessions, knowledge, discovery, plans),
      owner,
    );
    return {
      sessions,
      turns,
      plans,
      model,
      counted,
      knowledge: asRequests(knowledge, owner),
      discovery: asRequests(discovery, owner),
    };
  };
  const req = () => ({ correlationId: randomUUID(), ip: '203.0.113.9', userAgent: 'spec' });
  const follow = async (
    s: ReturnType<typeof build>,
    actor: Actor,
    turn: Awaited<ReturnType<AssistantTurnService['ask']>>,
  ): Promise<TurnEvent[]> => {
    const events: TurnEvent[] = [...turn.opening];
    await s.turns.run(actor, turn, req(), (e) => events.push(e), new AbortController().signal);
    return events;
  };
  /** Every place a secret could have been written down, searched for it. */
  const anywhere = async (secret: string) => {
    const rows = await owner<{ n: number }[]>`
      SELECT ((SELECT count(*) FROM ai_messages WHERE content LIKE ${`%${secret}%`} OR event::text LIKE ${`%${secret}%`}
                OR metadata::text LIKE ${`%${secret}%`})
           + (SELECT count(*) FROM ai_plan_steps WHERE arguments::text LIKE ${`%${secret}%`})
           + (SELECT count(*) FROM audit_logs WHERE coalesce(reason, '') LIKE ${`%${secret}%`}
                OR coalesce(new_state::text, '') LIKE ${`%${secret}%`})
           + (SELECT count(*) FROM outbox_events WHERE payload::text LIKE ${`%${secret}%`})
           + (SELECT count(*) FROM ai_sessions WHERE coalesce(title, '') LIKE ${`%${secret}%`}))::int AS n`;
    return rows[0]!.n;
  };

  describe('a pasted key', () => {
    it('is masked before it is stored, answered by the screen, and reaches no model', async () => {
      const s = build();
      const me = await person(owner);
      const session = await s.sessions.create(me, {}, req());
      const turn = await s.turns.ask(
        me,
        session.id,
        { content: `Here is my key ${KEY} — why does it fail?` },
        req(),
      );
      const events = await follow(s, me, turn);

      const messages = events.filter((e) => e.type === 'message').map((e) => e.message);
      expect(messages.map((m) => [m.role, m.content, m.metadata])).toEqual([
        ['USER', `Here is my key ${MASK} — why does it fail?`, { screened: ['api_key'] }],
        ['ASSISTANT', '', { source: 'screen', status: 'credential', kinds: ['api_key'] }],
      ]);
      // Named from its first words — masked too.
      expect((await s.sessions.open(me, session.id, req())).title).not.toContain(KEY);
      // No model saw it; no allowance was spent on it.
      expect(s.model.sent).toEqual([]);
      expect(s.counted).toEqual([]);
      expect(await anywhere(KEY)).toBe(0);
      // The search finds what is there: the rest of the message, stored.
      expect(await anywhere('why does it fail?')).toBeGreaterThan(0);
    });

    it('is answered by the screen again on a retry, never by a model', async () => {
      const s = build();
      const me = await person(owner);
      const session = await s.sessions.create(me, {}, req());
      // Stored and screened, but the reply was never written — a dropped connection.
      await s.turns.ask(me, session.id, { content: `password: ${KEY}` }, req());
      const events = await follow(s, me, await s.turns.retry(me, session.id, {}, req()));
      expect(events).toMatchObject([
        {
          type: 'message',
          message: { metadata: { source: 'screen', kinds: ['api_key', 'password'] } },
        },
      ]);
      expect(s.model.sent).toEqual([]);
      expect(await anywhere(KEY)).toBe(0);
    });

    it('is refused by the answers that store nothing, before any model or allowance', async () => {
      const s = build();
      const me = await person(owner);
      await expect(
        s.knowledge.answer(me, { question: `What is ${KEY} for?` }, req()),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: [{ code: 'CREDENTIAL' }] });
      await expect(
        s.discovery.answer(
          me,
          { question: 'Find someone in Yerevan', purpose: `token ${KEY}` },
          req(),
        ),
      ).rejects.toMatchObject({ details: [{ field: 'purpose', code: 'CREDENTIAL' }] });
      expect(s.model.sent).toEqual([]);
      expect(s.counted).toEqual([]);
      expect(await anywhere(KEY)).toBe(0);
    });
  });

  describe('a yes while a plan waits', () => {
    it('is pointed at the plan, confirms nothing, and reaches no model', async () => {
      const s = build();
      const me = await person(owner);
      const session = await s.sessions.create(me, {}, req());
      const plan = await s.plans.propose(
        me,
        session.id,
        [{ tool: 'addToTally', arguments: { name: 'rent', amount: 5 } }],
        req(),
      );

      const events = await follow(
        s,
        me,
        await s.turns.ask(me, session.id, { content: 'Yes!' }, req()),
      );
      expect(events.filter((e) => e.type === 'message').map((e) => e.message.metadata)).toEqual([
        {},
        { source: 'routing', status: 'confirm_pointer', planId: plan.id },
      ]);
      expect((await s.plans.get(me, session.id, plan.id, req())).status).toBe('PROPOSED');
      expect(s.model.sent).toEqual([]);

      // Retried with nothing written back: pointed at it again.
      await s.turns.ask(me, session.id, { content: 'подтверждаю' }, req());
      const again = await follow(s, me, await s.turns.retry(me, session.id, {}, req()));
      expect(again).toMatchObject([
        { type: 'message', message: { metadata: { status: 'confirm_pointer', planId: plan.id } } },
      ]);
      expect((await s.plans.get(me, session.id, plan.id, req())).status).toBe('PROPOSED');
    });

    it('is answered as any question once nothing waits, or when it answers discovery', async () => {
      const s = build();
      const me = await person(owner);
      const session = await s.sessions.create(me, {}, req());
      const events = await follow(
        s,
        me,
        await s.turns.ask(me, session.id, { content: 'yes' }, req()),
      );
      expect(events.at(-1)).toMatchObject({
        type: 'message',
        message: { metadata: { source: 'knowledge' } },
      });
      expect(s.model.sent.length).toBeGreaterThan(0);
    });
  });

  it('refuses a message that is nothing once normalized, and stores nothing', async () => {
    const s = build();
    const me = await person(owner);
    const session = await s.sessions.create(me, {}, req());
    await expect(
      s.turns.ask(me, session.id, { content: '\u200B\u200B\u200B\u200B' }, req()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: [{ field: 'content', code: 'TOO_SHORT' }],
    });
    await expect(
      s.turns.ask(me, session.id, { content: 'x'.repeat(2001) }, req()),
    ).rejects.toMatchObject({ details: [{ code: 'TOO_LONG' }] });
    expect((await s.sessions.messages(me, session.id, {}, req())).items).toEqual([]);
  });

  it('stores the words as normalized', async () => {
    const s = build();
    const me = await person(owner);
    const session = await s.sessions.create(me, {}, req());
    const turn = await s.turns.ask(
      me,
      session.id,
      { content: '  Who works\u200B in   Yerevan?  ' },
      req(),
    );
    expect(turn.opening[0]).toMatchObject({ message: { content: 'Who works in Yerevan?' } });
  });
});
