import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { knowledgeAudience, knowledgeVisibility } from '../../database/schema';

/** The folder the knowledge base lives in, relative to the repository root. Nothing else is read. */
export const KNOWLEDGE_BASE_DIR = 'docs/knowledge-base';

/** The marker every `docs/operations/` document carries (T-015). Refused here too. */
export const NOT_FOR_INGESTION = '<!-- not-for-ingestion -->';

/** A section longer than this is split at paragraph boundaries, each part keeping its question. */
export const MAX_CHUNK_CHARS = 2400;

export type Audience = (typeof knowledgeAudience.enumValues)[number];
export type Visibility = (typeof knowledgeVisibility.enumValues)[number];

/** The folder a document sits in decides nothing — but a mismatch with its visibility is refused. */
const FOLDER_VISIBILITY: Readonly<Record<string, readonly Visibility[]>> = {
  customer: ['authenticated', 'participant'],
  investigator: ['authenticated', 'participant'],
  agency: ['authenticated', 'participant'],
  staff: ['staff'],
  policies: ['public'],
};

export interface SourceChunk {
  ordinal: number;
  heading: string;
  content: string;
  contentHash: string;
}

export interface SourceDocument {
  docKey: string;
  locale: string;
  version: number;
  status: 'current' | 'superseded';
  title: string;
  audience: Audience;
  visibility: Visibility;
  sourceOfTruth: string;
  implementationStatus: string | null;
  relatedCode: string[];
  tags: string[];
  updatedOn: string;
  sourcePath: string;
  contentHash: string;
  chunks: SourceChunk[];
}

/** Why a file was not ingested. Every one fails the sync: a document that cannot be read is a bug. */
export class KnowledgeSourceError extends Error {}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Reads the knowledge base from `root`, the repository root (T-016).
 *
 * Only `docs/knowledge-base/**` is read, and only regular files: a symlink is refused wherever it
 * points, so nothing outside — `docs/operations/` above all — can reach retrieval by being linked
 * in, and a file carrying the operations marker is refused even if copied. Drafts are skipped: a
 * draft is not guidance yet.
 */
export function readKnowledgeBase(root: string): SourceDocument[] {
  const base = join(root, KNOWLEDGE_BASE_DIR);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new KnowledgeSourceError(`${relative(root, path)}: symlinks are not ingested`);
      }
      if (stat.isDirectory()) walk(path);
      else if (entry.endsWith('.md') && entry !== 'README.md') files.push(path);
    }
  };
  walk(base);

  return files
    .sort()
    .map((path) =>
      parseDocument(relative(root, path).split(sep).join('/'), readFileSync(path, 'utf8')),
    )
    .filter((d): d is SourceDocument => d !== null);
}

/** One file, or null for a draft. Refuses anything the validator would (T-015). */
export function parseDocument(sourcePath: string, text: string): SourceDocument | null {
  const fail = (why: string): never => {
    throw new KnowledgeSourceError(`${sourcePath}: ${why}`);
  };
  if (text.includes(NOT_FOR_INGESTION)) fail('marked not-for-ingestion');
  if (!text.startsWith('---\n')) fail('missing frontmatter');
  const end = text.indexOf('\n---\n', 3);
  if (end === -1) fail('unterminated frontmatter');

  const fm = parseFrontmatter(text.slice(4, end));
  const body = text.slice(end + 5);
  const field = (name: string): string => {
    const value = fm.scalars.get(name);
    return value === undefined || value === '' ? fail(`missing ${name}`) : value;
  };

  const status = field('status');
  if (status === 'draft') return null;
  if (status !== 'current' && status !== 'superseded') fail(`status '${status}'`);

  const audience = field('audience');
  if (!(knowledgeAudience.enumValues as readonly string[]).includes(audience))
    fail(`audience '${audience}'`);
  const visibility = field('visibility');
  if (!(knowledgeVisibility.enumValues as readonly string[]).includes(visibility)) {
    fail(`visibility '${visibility}'`);
  }
  const folder = sourcePath.split('/')[2]!;
  const allowed = FOLDER_VISIBILITY[folder];
  if (allowed !== undefined && !allowed.includes(visibility as Visibility)) {
    fail(`visibility '${visibility}' is wrong for ${folder}/`);
  }
  const version = Number(field('version'));
  if (!Number.isInteger(version) || version < 1) fail(`version '${fm.scalars.get('version')}'`);
  const updatedOn = field('updated');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updatedOn)) fail(`updated '${updatedOn}'`);

  const title = field('title');
  const chunks = chunk(title, body);
  // A document with no answer in it has nothing to retrieve; it is a file someone forgot to write.
  if (chunks.length === 0) fail('no content to retrieve');
  return {
    docKey: field('id'),
    locale: field('locale'),
    version,
    status: status as 'current' | 'superseded',
    title,
    audience: audience as Audience,
    visibility: visibility as Visibility,
    sourceOfTruth: field('source_of_truth'),
    implementationStatus: fm.scalars.get('implementation_status') ?? null,
    relatedCode: fm.lists.get('related_code') ?? [],
    tags: fm.lists.get('tags') ?? [],
    updatedOn,
    sourcePath,
    contentHash: sha256(text),
    chunks,
  };
}

/**
 * The frontmatter the knowledge base uses: `key: value`, inline lists `[a, b]`, and block lists of
 * `  - item` lines. Nothing more — it is not a YAML parser, and a shape it does not know is ignored
 * by the ingestion and caught by the validator (T-015).
 */
function parseFrontmatter(block: string): {
  scalars: Map<string, string>;
  lists: Map<string, string[]>;
} {
  const scalars = new Map<string, string>();
  const lists = new Map<string, string[]>();
  let listKey: string | undefined;
  for (const line of block.split('\n')) {
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item !== null && listKey !== undefined) {
      lists.get(listKey)!.push(item[1]!);
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (kv === null) continue;
    const [, key, value] = kv as unknown as [string, string, string];
    if (value === '') {
      listKey = key;
      lists.set(key, []);
    } else if (value.startsWith('[') && value.endsWith(']')) {
      listKey = undefined;
      lists.set(
        key,
        value
          .slice(1, -1)
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v !== ''),
      );
    } else {
      listKey = undefined;
      scalars.set(key, value.replace(/^['"](.*)['"]$/, '$1'));
    }
  }
  return { scalars, lists };
}

/**
 * One chunk per `## ` question, retrieved alone — so each keeps its heading, and a long answer is
 * split at paragraph boundaries rather than mid-idea. What precedes the first question (the
 * document's framing, usually a note on where its values live) is a chunk of its own under the
 * document's title.
 */
export function chunk(title: string, body: string): SourceChunk[] {
  const sections: Array<{ heading: string; content: string }> = [];
  const parts = body.split(/^## +/m);
  const preamble = parts[0]!.replace(/^# .*$/m, '').trim();
  if (preamble !== '') sections.push({ heading: title, content: preamble });
  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n');
    const heading = (newline === -1 ? part : part.slice(0, newline)).trim();
    const content = newline === -1 ? '' : part.slice(newline + 1).trim();
    if (content !== '') sections.push({ heading, content });
  }

  const chunks: SourceChunk[] = [];
  for (const { heading, content } of sections) {
    for (const piece of split(content)) {
      chunks.push({
        ordinal: chunks.length,
        heading,
        content: piece,
        contentHash: sha256(`${heading}\n${piece}`),
      });
    }
  }
  return chunks;
}

function split(content: string): string[] {
  if (content.length <= MAX_CHUNK_CHARS) return [content];
  const pieces: string[] = [];
  let current = '';
  for (const paragraph of content.split(/\n{2,}/)) {
    if (current !== '' && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      pieces.push(current);
      current = '';
    }
    current = current === '' ? paragraph : `${current}\n\n${paragraph}`;
  }
  pieces.push(current);
  return pieces;
}

/** Where reviewed overlaps are recorded, relative to the repository root. */
export const REVIEWED_OVERLAPS = `${KNOWLEDGE_BASE_DIR}/overlaps-reviewed.yml`;

/** An overlap someone read and found consistent, for these two versions (T-016). */
export interface ReviewedOverlap {
  subject: string;
  /** Two `id@version`, in any order. */
  documents: [string, string];
}

/**
 * The reviewed-overlaps file: a list of `- subject: …` entries with `documents: [a@n, b@m]`. Other
 * fields are for the person reading the file. A malformed entry fails the sync rather than being
 * skipped, since a skipped review would quietly turn a flag back on.
 */
export function readReviewedOverlaps(root: string): ReviewedOverlap[] {
  const path = join(root, REVIEWED_OVERLAPS);
  if (!existsSync(path)) return [];
  const entries: ReviewedOverlap[] = [];
  let pending: { subject?: string; documents?: string[] } | undefined;
  const flush = () => {
    if (pending === undefined) return;
    const docs = pending.documents ?? [];
    if (
      pending.subject === undefined ||
      docs.length !== 2 ||
      !docs.every((d) => /^[\w-]+@\d+$/.test(d))
    ) {
      throw new KnowledgeSourceError(
        `${REVIEWED_OVERLAPS}: an entry needs a subject and two id@version documents`,
      );
    }
    entries.push({ subject: pending.subject, documents: [docs[0]!, docs[1]!] });
    pending = undefined;
  };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue;
    const start = /^-\s+subject:\s*(.+?)\s*$/.exec(line);
    if (start !== null) {
      flush();
      pending = { subject: start[1]! };
      continue;
    }
    const docs = /^\s+documents:\s*\[(.*)\]\s*$/.exec(line);
    if (docs !== null && pending !== undefined) {
      pending.documents = docs[1]!
        .split(',')
        .map((d) => d.trim())
        .filter((d) => d !== '');
    }
  }
  flush();
  return entries;
}
