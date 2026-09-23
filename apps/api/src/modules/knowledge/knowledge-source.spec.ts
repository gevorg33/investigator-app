import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { knowledgeAudience, knowledgeVisibility } from '../../database/schema';
import {
  chunk,
  MAX_CHUNK_CHARS,
  NOT_FOR_INGESTION,
  parseDocument,
  readKnowledgeBase,
  readReviewedOverlaps,
} from './knowledge-source';

const ROOT = join(__dirname, '../../../../..');

export const frontmatter = (over: Record<string, string> = {}, extra = '') =>
  `---\n${Object.entries({
    id: 'kb-test-doc',
    title: 'A test document',
    audience: 'customer',
    visibility: 'authenticated',
    locale: 'en',
    version: '1',
    status: 'current',
    updated: '2026-09-24',
    source_of_truth: 'docs',
    ...over,
  })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n${extra}---\n`;

const doc = (
  over: Record<string, string> = {},
  body = '# Title\n\n## Can I test this?\n\nYes.\n',
  extra = '',
) => `${frontmatter(over, extra)}\n${body}`;

describe('reading the knowledge base (T-016)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const repo = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-sync-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'docs/knowledge-base'), { recursive: true });
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  };

  it('reads every document of the repository’s own knowledge base', () => {
    const docs = readKnowledgeBase(ROOT);
    expect(docs.length).toBeGreaterThan(30);
    expect(docs.every((d) => d.sourcePath.startsWith('docs/knowledge-base/'))).toBe(true);
    expect(docs.every((d) => d.chunks.length > 0)).toBe(true);
  });

  it('never reads docs/operations — the folder is not walked, whatever is in it', () => {
    const dir = repo({
      'docs/knowledge-base/customer/a.en.md': doc(),
      'docs/operations/escalation.md': doc({
        id: 'kb-ops',
        audience: 'staff',
        visibility: 'staff',
      }),
    });
    expect(readKnowledgeBase(dir).map((d) => d.docKey)).toEqual(['kb-test-doc']);
  });

  it('refuses an operations document copied in, even with frontmatter', () => {
    const dir = repo({
      'docs/knowledge-base/staff/escalation.en.md': doc(
        { audience: 'staff', visibility: 'staff' },
        `# Escalation\n\n${NOT_FOR_INGESTION}\n\n## Who do I call?\n\nThe procedure.\n`,
      ),
    });
    expect(() => readKnowledgeBase(dir)).toThrow(/not-for-ingestion/);
  });

  it('refuses a symlink, whatever it points at', () => {
    const dir = repo({ 'docs/operations/escalation.md': '# Escalation\n' });
    symlinkSync(join(dir, 'docs/operations'), join(dir, 'docs/knowledge-base/ops'));
    expect(() => readKnowledgeBase(dir)).toThrow(/symlinks are not ingested/);
  });

  it('skips a draft — it is not guidance yet — and the README', () => {
    const dir = repo({
      'docs/knowledge-base/customer/a.en.md': doc({ status: 'draft' }),
      'docs/knowledge-base/README.md': '# Knowledge base\n',
    });
    expect(readKnowledgeBase(dir)).toEqual([]);
  });

  it('reads visibility from the frontmatter, and refuses one that does not belong in its folder', () => {
    expect(
      parseDocument(
        'docs/knowledge-base/staff/a.en.md',
        doc({ audience: 'staff', visibility: 'staff' }),
      )?.visibility,
    ).toBe('staff');
    expect(() =>
      parseDocument(
        'docs/knowledge-base/staff/a.en.md',
        doc({ audience: 'staff', visibility: 'public' }),
      ),
    ).toThrow(/wrong for staff/);
  });

  it.each([
    ['no frontmatter', '# Just prose\n', /missing frontmatter/],
    ['unterminated frontmatter', '---\nid: x\n', /unterminated/],
    ['a missing field', doc({ title: '' }), /missing title/],
    ['an unknown status', doc({ status: 'archived' }), /status 'archived'/],
    ['an unknown audience', doc({ audience: 'everyone' }), /audience 'everyone'/],
    ['an unknown visibility', doc({ visibility: 'secret' }), /visibility 'secret'/],
    ['a version that is not one', doc({ version: 'two' }), /version 'two'/],
    ['a date that is not one', doc({ updated: 'yesterday' }), /updated 'yesterday'/],
    ['a document with no answer in it', doc({}, '# Title\n\n## A question alone?\n'), /no content/],
  ])('refuses %s', (_what, text, error) => {
    expect(() => parseDocument('docs/knowledge-base/customer/a.en.md', text)).toThrow(error);
  });

  it('reads both list shapes, quoted scalars, and hashes the whole file', () => {
    const text = doc(
      { title: '"Quoted title"', implementation_status: 'partial' },
      '# T\n\n## Q?\n\nA.\n',
      'related_code:\n  - apps/api/src/modules/quotes\n  - apps/api/src/modules/missions\ntags: [quotes, expiry]\n',
    );
    const parsed = parseDocument('docs/knowledge-base/customer/a.en.md', text)!;
    expect([parsed.title, parsed.implementationStatus, parsed.relatedCode, parsed.tags]).toEqual([
      'Quoted title',
      'partial',
      ['apps/api/src/modules/quotes', 'apps/api/src/modules/missions'],
      ['quotes', 'expiry'],
    ]);
    expect(parsed.contentHash).toMatch(/^[0-9a-f]{64}$/);
    // A blank line in frontmatter is YAML's, not a field; it is passed over.
    expect(
      parseDocument('docs/knowledge-base/customer/a.en.md', text.replace('tags:', '\ntags:'))!.tags,
    ).toEqual(['quotes', 'expiry']);
    expect(parseDocument('docs/knowledge-base/customer/a.en.md', text)!.contentHash).toBe(
      parsed.contentHash,
    );
  });

  it('holds the same enumerations the validator does — two lists that could drift apart', () => {
    const validator = readFileSync(join(ROOT, 'scripts/validate-knowledge-base.py'), 'utf8');
    const set = (name: string) =>
      new RegExp(`"${name}":\\s*\\{([^}]*)\\}`)
        .exec(validator)![1]!
        .match(/"([a-z]+)"/g)!
        .map((s) => s.slice(1, -1))
        .sort();
    expect([...knowledgeAudience.enumValues].sort()).toEqual(set('audience'));
    expect([...knowledgeVisibility.enumValues].sort()).toEqual(set('visibility'));
  });
});

describe('chunking — one question per chunk, retrieved alone', () => {
  it('makes the framing a chunk under the title, and each question its own', () => {
    const chunks = chunk(
      'Profile',
      '# Profile\n\n> Values live in your profile.\n\n## What is a specialty?\n\nA domain.\n\n## Empty?\n\n',
    );
    expect(chunks.map((c) => [c.ordinal, c.heading, c.content])).toEqual([
      [0, 'Profile', '> Values live in your profile.'],
      [1, 'What is a specialty?', 'A domain.'],
    ]);
  });

  it('splits a long answer at paragraph boundaries, each part keeping its question', () => {
    const paragraph = (n: number) => `${n} ${'word '.repeat(300).trim()}`;
    const chunks = chunk(
      'T',
      `## Why so long?\n\n${paragraph(1)}\n\n${paragraph(2)}\n\n${paragraph(3)}\n`,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((c) => c.heading === 'Why so long?' && c.content.length <= MAX_CHUNK_CHARS),
    ).toBe(true);
    expect(new Set(chunks.map((c) => c.contentHash)).size).toBe(chunks.length);
  });

  it('keeps a paragraph whole, even one longer than a chunk, and joins short ones after it', () => {
    // A paragraph has no boundary inside it to split at; the ones after it share a chunk.
    const long = 'word '.repeat(MAX_CHUNK_CHARS).trim();
    expect(
      chunk('T', `## Why so long?\n\n${long}\n\nShort.\n\nAlso short.\n`).map((c) => c.content),
    ).toEqual([long, 'Short.\n\nAlso short.']);
  });

  it('makes nothing of a document with neither framing nor questions', () => {
    expect(chunk('Empty', '# Empty\n')).toEqual([]);
  });

  it('keeps a heading-only section out', () => {
    expect(chunk('T', '## Just a heading')).toEqual([]);
  });
});

describe('reviewed overlaps', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const withFile = (text?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'kb-rev-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'docs/knowledge-base'), { recursive: true });
    if (text !== undefined)
      writeFileSync(join(dir, 'docs/knowledge-base/overlaps-reviewed.yml'), text);
    return dir;
  };

  it('reads the repository’s own record', () => {
    expect(readReviewedOverlaps(ROOT).length).toBeGreaterThan(0);
  });

  it('is empty when there is no record', () => {
    expect(readReviewedOverlaps(withFile())).toEqual([]);
  });

  it('reads entries, ignoring comments and the fields meant for people', () => {
    const dir = withFile(
      '# note\n\n- subject: how long is my data kept\n  documents: [kb-a@2, kb-b@1]\n  by: someone\n',
    );
    expect(readReviewedOverlaps(dir)).toEqual([
      { subject: 'how long is my data kept', documents: ['kb-a@2', 'kb-b@1'] },
    ]);
  });

  it.each([
    ['one document', '- subject: x\n  documents: [kb-a@2]\n'],
    ['a document with no version', '- subject: x\n  documents: [kb-a, kb-b@1]\n'],
    ['no documents at all', '- subject: x\n'],
  ])('refuses an entry with %s, rather than skipping it', (_what, text) => {
    expect(() => readReviewedOverlaps(withFile(text))).toThrow(/two id@version documents/);
  });
});
