import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HashingEmbedder } from '../../../test/hashing-embedder';
import { runKnowledgeSync, type CliOptions } from './knowledge-sync.cli';

const document = (id: string, question: string, extra = '') =>
  [
    '---',
    `id: ${id}`,
    `title: ${id}`,
    'audience: customer',
    'visibility: authenticated',
    'locale: en',
    'version: 1',
    'status: current',
    'updated: 2026-09-24',
    'source_of_truth: docs',
    extra,
    '---',
    '',
    `## ${question}\n\nAn answer.\n`,
  ]
    .filter((l) => l !== '')
    .join('\n');

describe('the knowledge:sync command (T-016)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** A repository holding just these files, and the command's working directory inside it. */
  const repo = (files: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'kb-cli-'));
    dirs.push(root);
    mkdirSync(join(root, 'apps/api'), { recursive: true });
    mkdirSync(join(root, 'docs/knowledge-base'), { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    return root;
  };

  const run = async (root: string, over: Partial<CliOptions> = {}) => {
    const lines: string[] = [];
    const code = await runKnowledgeSync({
      argv: [],
      env: {},
      cwd: join(root, 'apps/api'),
      out: (l) => lines.push(l),
      ...over,
    });
    return { code, lines, text: lines.join('\n') };
  };

  it('ingests the repository two levels up, says what it did, and nothing the second time', async () => {
    const root = repo({ 'docs/knowledge-base/customer/a.en.md': document('kb-cli-a', 'Can I?') });
    const first = await run(root);
    expect(first.code).toBe(0);
    expect(first.lines).toContain(
      'knowledge: no OPENAI_API_KEY — ingesting without embeddings; they stay pending',
    );
    expect(first.text).toMatch(
      /1 documents — 1 created, 0 updated.*1 pending; 0 conflicts open, 0 overlaps reviewed/,
    );
    expect(first.lines).toContain('  en/kb-cli-a@1');

    const again = await run(root);
    expect(again.text).toMatch(/0 created, 0 updated, 0 superseded, 0 removed, 1 unchanged/);
  });

  it('takes the repository from --root', async () => {
    const root = repo({
      'docs/knowledge-base/customer/a.en.md': document('kb-cli-root', 'Can I?'),
    });
    const { code, text } = await run(root, { argv: ['--root', root], cwd: tmpdir() });
    expect([code, text]).toEqual([0, expect.stringMatching(/1 created/)]);
  });

  it('refuses a document it cannot ingest, without touching the database', async () => {
    const root = repo({ 'docs/knowledge-base/customer/bad.en.md': '# No frontmatter\n' });
    const { code, lines } = await run(root);
    expect(code).toBe(1);
    expect(lines).toEqual([
      expect.stringMatching(/^knowledge: refused — docs\/knowledge-base\/customer\/bad\.en\.md/),
    ]);
  });

  it('lets anything but a refusal through as the failure it is', async () => {
    await expect(run(join(tmpdir(), 'kb-cli-no-such-repo'))).rejects.toThrow(/ENOENT/);
  });

  it('prints each conflict, and fails on one only when asked to', async () => {
    const root = repo({
      'docs/knowledge-base/customer/a.en.md': document('kb-cli-one', 'How long does a quote last?'),
      'docs/knowledge-base/customer/b.en.md': document('kb-cli-two', 'How long does a quote last?'),
    });
    const plain = await run(root);
    expect(plain.code).toBe(0);
    expect(plain.lines).toContainEqual(
      expect.stringMatching(
        /^ {2}CONFLICT same_question: "how long does a quote last" — docs\/knowledge-base\/customer\/a\.en\.md \(kb-cli-one@1\) and docs\/knowledge-base\/customer\/b\.en\.md \(kb-cli-two@1\)$/,
      ),
    );
    expect((await run(root, { argv: ['--fail-on-conflict'] })).code).toBe(1);
  });

  it('sets aside an overlap recorded as reviewed', async () => {
    const root = repo({
      'docs/knowledge-base/customer/a.en.md': document('kb-cli-r1', 'How long does a quote last?'),
      'docs/knowledge-base/customer/b.en.md': document('kb-cli-r2', 'How long does a quote last?'),
      'docs/knowledge-base/overlaps-reviewed.yml':
        '- subject: how long does a quote last\n  documents: [kb-cli-r1@1, kb-cli-r2@1]\n',
    });
    const { code, text } = await run(root, { argv: ['--fail-on-conflict'] });
    expect([code, text]).toEqual([
      0,
      expect.stringMatching(/0 conflicts open, 1 overlaps reviewed/),
    ]);
  });

  it('embeds with the embedder it is given', async () => {
    const root = repo({
      'docs/knowledge-base/customer/a.en.md': document('kb-cli-embed', 'Can I?'),
    });
    const { text } = await run(root, { embedder: new HashingEmbedder() });
    expect(text).toMatch(/1 chunks embedded, 0 pending/);
  });

  it('uses OpenAI when a key is configured, with the model the environment names', async () => {
    const root = repo({
      'docs/knowledge-base/customer/a.en.md': document('kb-cli-openai', 'Can I?'),
    });
    const http = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { input } = JSON.parse(init?.body as string) as { input: string[] };
      return Response.json({
        data: input.map((_, index) => ({
          index,
          embedding: new Array(1536).fill(1 / Math.sqrt(1536)),
        })),
      });
    });
    vi.stubGlobal('fetch', http);
    const { lines, text } = await run(root, {
      env: { OPENAI_API_KEY: 'sk-test', OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large' },
    });
    expect(text).toMatch(/1 chunks embedded/);
    expect(lines.some((l) => l.includes('no OPENAI_API_KEY'))).toBe(false);
    expect(JSON.parse(http.mock.calls[0]![1]!.body as string)).toMatchObject({
      model: 'text-embedding-3-large',
      dimensions: 1536,
    });
  });

  it('defaults to the small embedding model', async () => {
    const root = repo({
      'docs/knowledge-base/customer/a.en.md': document('kb-cli-default', 'Can I?'),
    });
    const http = vi.fn(async () =>
      Response.json({ data: [{ index: 0, embedding: new Array(1536).fill(0.01) }] }),
    );
    vi.stubGlobal('fetch', http);
    await run(root, { env: { OPENAI_API_KEY: 'sk-test' } });
    expect(
      JSON.parse((http.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).model,
    ).toBe('text-embedding-3-small');
  });

  describe('--staleness', () => {
    it('reports code changed since the document said what it does', async () => {
      const root = repo({
        'docs/knowledge-base/customer/a.en.md': document(
          'kb-cli-stale',
          'Can I?',
          'related_code:\n  - apps/api/src/x',
        ),
      });
      const { lines } = await run(root, {
        argv: ['--staleness'],
        lastChanged: () => () => '2026-09-30',
      });
      expect(lines).toContain(
        'knowledge: 1 document references to code changed since the document',
      );
      expect(lines).toContain(
        '  STALE docs/knowledge-base/customer/a.en.md (updated 2026-09-24): apps/api/src/x changed 2026-09-30',
      );
    });

    it('says when the code a document describes does not exist', async () => {
      const root = repo({
        'docs/knowledge-base/customer/a.en.md': document(
          'kb-cli-missing',
          'Can I?',
          'implementation_status: partial\nrelated_code:\n  - apps/api/src/gone',
        ),
      });
      const { lines } = await run(root, { argv: ['--staleness'], lastChanged: () => () => null });
      expect(lines).toContain(
        '  STALE docs/knowledge-base/customer/a.en.md (updated 2026-09-24): apps/api/src/gone does not exist',
      );
    });

    it('asks git when nothing else is given', async () => {
      const root = repo({
        'docs/knowledge-base/customer/a.en.md': document('kb-cli-git', 'Can I?'),
      });
      const { lines } = await run(root, { argv: ['--staleness'] });
      expect(lines).toContain(
        'knowledge: 0 document references to code changed since the document',
      );
    });
  });
});
