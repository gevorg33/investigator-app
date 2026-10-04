import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { person, req } from '../../../../test/ai-plan-kit';
import { testPool } from '../../../../test/db';
import { agencyContext, asRequests, scopedDb } from '../../../../test/workspace-context';
import { agency } from '../../../../test/workspace-fixtures';
import { AuditService } from '../../../common/audit/audit.service';
import { AuthzService } from '../../../common/authz/authz.service';
import { runInContext } from '../../../common/context/execution-context';
import { AiSessionsService } from '../../ai-sessions/ai-sessions.service';
import { forContext, RESULT_PAGE, ToolResultStore, type ResultRef } from './tool-result-store';

/**
 * Large tool results (T-048, ADR-0006): kept whole, referenced by id, and put in front of a model a
 * page at a time — so ten thousand records never enter a prompt.
 */
describe('the tool result store (T-048)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let raw: ToolResultStore;
  let store: ToolResultStore;
  let sessions: AiSessionsService;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    raw = new ToolResultStore(db, new AuthzService(audit));
    store = asRequests(raw, owner);
    sessions = asRequests(new AiSessionsService(db, new AuthzService(audit), audit), owner);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  /** Ten thousand investigators-worth of rows, each one recognisable by its marker. */
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, marker: `record-${i + 1}-end` }));

  it('keeps ten thousand records and gives a model a summary and twenty of them — never the rest', async () => {
    const me = await person(owner);
    const session = await sessions.create(me, {}, req());
    const all = rows(10_000);

    const ref = await store.keep(
      me,
      session.id,
      { tool: 'searchInvestigators', items: all, summary: { matched: 10_000 } },
      req(),
    );

    expect(ref).toMatchObject({
      tool: 'searchInvestigators',
      total: 10_000,
      summary: { matched: 10_000 },
    });
    expect(ref.items).toEqual(all.slice(0, RESULT_PAGE));
    expect(ref.cursor).not.toBeNull();

    const prompt = forContext(ref);
    expect(JSON.parse(prompt)).toMatchObject({ resultId: ref.resultId, total: 10_000, more: true });
    expect((JSON.parse(prompt) as { items: unknown[] }).items).toHaveLength(RESULT_PAGE);
    for (const absent of [RESULT_PAGE + 1, 5_000, 10_000]) {
      expect(prompt).not.toContain(`record-${absent}-end`);
    }
    // The whole set is ~half a megabyte; what reaches a prompt is a page of it.
    expect(prompt.length).toBeLessThan(2_000);
    expect(JSON.stringify(all).length).toBeGreaterThan(300_000);

    const [stored] = await owner<{ total: number; n: number }[]>`
      SELECT total, jsonb_array_length(items) AS n FROM ai_tool_results WHERE id = ${ref.resultId}`;
    expect(stored).toEqual({ total: 10_000, n: 10_000 });
  });

  it('renders at most a page for a model, whatever it is handed', () => {
    const handed: ResultRef = {
      resultId: 'r',
      tool: 'searchInvestigators',
      total: 50,
      summary: {},
      items: rows(50),
      cursor: null,
    };
    const rendered = JSON.parse(forContext(handed)) as { items: unknown[]; more: boolean };
    expect(rendered.items).toHaveLength(RESULT_PAGE);
    expect(rendered.more).toBe(false);
  });

  it('pages through every record exactly once, in order, to an end', async () => {
    const me = await person(owner);
    const session = await sessions.create(me, {}, req());
    const all = rows(RESULT_PAGE * 2 + 5);
    let ref = await store.keep(
      me,
      session.id,
      { tool: 'listTaxonomy', items: all, summary: {} },
      req(),
    );
    const seen = [...ref.items];
    while (ref.cursor !== null) {
      ref = await store.page(me, ref.resultId, ref.cursor, req());
      seen.push(...ref.items);
    }
    expect(seen).toEqual(all);
    expect(ref.items).toHaveLength(5);

    // An empty result is a result: nothing to page.
    const none = await store.keep(
      me,
      session.id,
      { tool: 'listTaxonomy', items: [], summary: {} },
      req(),
    );
    expect([none.items, none.cursor, none.total]).toEqual([[], null, 0]);
  });

  it('refuses a cursor from another result, or one that is not a cursor', async () => {
    const me = await person(owner);
    const session = await sessions.create(me, {}, req());
    const a = await store.keep(
      me,
      session.id,
      { tool: 'listTaxonomy', items: rows(30), summary: {} },
      req(),
    );
    const b = await store.keep(
      me,
      session.id,
      { tool: 'listTaxonomy', items: rows(30), summary: {} },
      req(),
    );
    const forged = Buffer.from(JSON.stringify({ r: b.resultId, o: -20 })).toString('base64url');
    for (const cursor of [a.cursor!, 'not-a-cursor', forged]) {
      await expect(store.page(me, b.resultId, cursor, req())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [{ field: 'cursor', messageKey: 'error.validation.cursor.invalid' }],
      });
    }
  });

  it('is its owner’s alone: a stranger, or a colleague in the same agency, gets a 404 and stores nothing', async () => {
    const me = await person(owner);
    const stranger = await person(owner);
    const session = await sessions.create(me, {}, req());
    const ref = await store.keep(
      me,
      session.id,
      { tool: 'listTaxonomy', items: rows(3), summary: {} },
      req(),
    );

    await expect(store.page(stranger, ref.resultId, undefined, req())).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      store.keep(
        stranger,
        session.id,
        { tool: 'listTaxonomy', items: rows(3), summary: {} },
        req(),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const boss = await person(owner);
    const colleague = await person(owner);
    const firm = await agency(owner, [{ userId: boss.userId }, { userId: colleague.userId }]);
    const inFirm = (userId: string) => agencyContext(owner, userId, firm.tenantId);
    const theirs = await runInContext(await inFirm(colleague.userId), async () => {
      const s = await new AiSessionsService(
        scopedDb(sql),
        new AuthzService(new AuditService(scopedDb(sql))),
        new AuditService(scopedDb(sql)),
      ).create(colleague, {}, req());
      return raw.keep(
        colleague,
        s.id,
        { tool: 'listTaxonomy', items: rows(3), summary: {} },
        req(),
      );
    });
    await expect(
      runInContext(await inFirm(boss.userId), () =>
        raw.page(boss, theirs.resultId, undefined, req()),
      ),
    ).rejects.toMatchObject({ status: 404 });

    const [n] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ai_tool_results WHERE session_id = ${session.id}`;
    expect(n!.n).toBe(1);
  });

  it('is written once: no writer rewrites a stored result', async () => {
    const me = await person(owner);
    const session = await sessions.create(me, {}, req());
    const ref = await store.keep(
      me,
      session.id,
      { tool: 'listTaxonomy', items: rows(2), summary: {} },
      req(),
    );
    await expect(
      owner`UPDATE ai_tool_results SET summary = '{"edited":true}' WHERE id = ${ref.resultId}`,
    ).rejects.toThrow(/ai_tool_result_fixed/);
  });

  it('is read by nothing but the store — and erased with its session by the session service', () => {
    // forContext is the one way a stored result reaches a prompt; a second reader would be a
    // second way. Only the schema, the store and the session's erasure may name the table.
    const src = join(__dirname, '../../..');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(join(dir, e.name))
          : /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name)
            ? [join(dir, e.name)]
            : [],
      );
    const readers = walk(src)
      .filter((f) => /aiToolResults|ai_tool_results/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f))
      .sort();
    expect(readers).toEqual([
      'database/schema/ai-plans.ts',
      'database/table-classes.ts',
      'modules/ai-sessions/ai-sessions.service.ts',
      'modules/ai/results/tool-result-store.ts',
    ]);
  });
});
