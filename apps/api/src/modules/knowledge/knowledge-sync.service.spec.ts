import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { HashingEmbedder } from '../../../test/hashing-embedder';
import { inWorkspaceOf, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { PlatformContext } from '../../common/context/platform-context';
import * as schema from '../../database/schema';
import {
  auditLogs,
  knowledgeChunks,
  knowledgeConflicts,
  knowledgeDocuments,
} from '../../database/schema';
import { parseDocument, type SourceDocument } from './knowledge-source';
import { KnowledgeSyncService } from './knowledge-sync.service';

/** A knowledge-base file, as the sync would read it. */
const file = (
  key: string,
  over: {
    version?: number;
    status?: string;
    audience?: string;
    visibility?: string;
    folder?: string;
  } = {},
  body = '# Title\n\n## How long does a quote last?\n\nSeven days unless it says otherwise.\n',
): SourceDocument => {
  const audience = over.audience ?? 'customer';
  const text = [
    '---',
    `id: ${key}`,
    `title: ${key}`,
    `audience: ${audience}`,
    `visibility: ${over.visibility ?? 'authenticated'}`,
    'locale: en',
    `version: ${over.version ?? 1}`,
    `status: ${over.status ?? 'current'}`,
    'updated: 2026-09-24',
    'source_of_truth: docs',
    '---',
    '',
    body,
  ].join('\n');
  return parseDocument(`docs/knowledge-base/${over.folder ?? audience}/${key}.en.md`, text)!;
};

describe('the knowledge sync (T-016)', () => {
  let sql: postgres.Sql;
  let owner: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let service: KnowledgeSyncService;
  const req = () => ({ correlationId: randomUUID() });
  const key = (stem: string) => `kb-${stem}-${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    sql = testPool();
    owner = testPool({ role: 'owner' });
    ownerDb = drizzle(owner, { schema });
  });

  beforeEach(() => {
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    service = new KnowledgeSyncService(db, new PlatformContext(audit), audit);
  });

  afterAll(async () => {
    await sql.end();
    await owner.end();
  });

  const docsOf = (docKey: string) =>
    ownerDb
      .select()
      .from(knowledgeDocuments)
      .where(eq(knowledgeDocuments.docKey, docKey))
      .orderBy(knowledgeDocuments.version);
  const chunksOf = async (docKey: string) => {
    const docs = await docsOf(docKey);
    const current = docs.find((d) => d.status === 'current');
    return current === undefined
      ? []
      : ownerDb
          .select()
          .from(knowledgeChunks)
          .where(eq(knowledgeChunks.documentId, current.id))
          .orderBy(knowledgeChunks.ordinal);
  };
  const allChunksOf = async (docKey: string) => {
    const ids = (await docsOf(docKey)).map((d) => d.id);
    const rows = await ownerDb.select().from(knowledgeChunks);
    return rows.filter((c) => ids.includes(c.documentId));
  };

  describe('keeping the database in step with the files', () => {
    it('creates a document and its chunks, copying who may see them from the document', async () => {
      const k = key('create');
      const report = await service.sync(
        [file(k, { audience: 'staff', visibility: 'staff' })],
        undefined,
        req(),
      );
      expect(report.created).toEqual([`en/${k}@1`]);
      const [row] = await docsOf(k);
      expect([row?.status, row?.visibility, row?.tenantId]).toEqual(['current', 'staff', null]);
      const chunks = await chunksOf(k);
      expect(chunks.map((c) => [c.heading, c.visibility, c.locale])).toEqual([
        ['How long does a quote last?', 'staff', 'en'],
      ]);
      expect(chunks[0]?.embedding).toBeNull();
    });

    it('does nothing the second time — keyed on the content', async () => {
      const k = key('noop');
      const source = [file(k)];
      await service.sync(source, undefined, req());
      const before = await chunksOf(k);
      const again = await service.sync(source, undefined, req());
      expect([again.created, again.updated, again.unchanged]).toEqual([[], [], 1]);
      expect((await chunksOf(k)).map((c) => c.id)).toEqual(before.map((c) => c.id));
    });

    it('corrects a document in place when its version did not change, keeping unchanged embeddings', async () => {
      const k = key('edit');
      const embedder = new HashingEmbedder();
      const body = '## How long does a quote last?\n\nSeven days.\n\n## Can I extend one?\n\nNo.\n';
      await service.sync([file(k, {}, body)], embedder, req());
      const kept = (await chunksOf(k)).find((c) => c.heading === 'How long does a quote last?')!;

      embedder.calls.length = 0;
      const report = await service.sync(
        [file(k, {}, body.replace('No.', 'Ask the investigator.'))],
        embedder,
        req(),
      );
      expect(report.updated).toEqual([`en/${k}@1`]);
      const after = await chunksOf(k);
      // The unchanged answer kept its vector; only the changed one was sent to be embedded.
      expect(after.find((c) => c.heading === 'How long does a quote last?')?.embeddedAt).toEqual(
        kept.embeddedAt,
      );
      expect(embedder.calls.flat()).toEqual(['Can I extend one?\n\nAsk the investigator.']);
    });

    it('supersedes on a new version: the old one is kept, and its chunks leave in the same transaction', async () => {
      const k = key('supersede');
      await service.sync([file(k)], undefined, req());
      const report = await service.sync(
        [file(k, { version: 2 }, '## New question?\n\nNew answer.\n')],
        undefined,
        req(),
      );
      expect([report.superseded, report.created]).toEqual([[`en/${k}@1`], [`en/${k}@2`]]);

      const [v1, v2] = await docsOf(k);
      expect([v1?.status, v1?.retiredAt !== null, v2?.status]).toEqual([
        'superseded',
        true,
        'current',
      ]);
      expect((await allChunksOf(k)).map((c) => c.heading)).toEqual(['New question?']);
    });

    it('supersedes when the file says so, and no longer retrieves it', async () => {
      const k = key('marked');
      await service.sync([file(k)], undefined, req());
      const report = await service.sync([file(k, { status: 'superseded' })], undefined, req());
      expect(report.superseded).toEqual([`en/${k}@1`]);
      expect(await allChunksOf(k)).toEqual([]);
      // And a superseded file seen again is a no-op, not a resurrection.
      expect(
        (await service.sync([file(k, { status: 'superseded' })], undefined, req())).unchanged,
      ).toBe(1);
    });

    it('re-scopes every chunk at once when a document’s visibility narrows', async () => {
      const k = key('narrowed');
      await service.sync([file(k, { visibility: 'authenticated' })], undefined, req());
      await service.sync([file(k, { visibility: 'participant' })], undefined, req());
      expect((await chunksOf(k)).map((c) => c.visibility)).toEqual(['participant']);
    });

    it('removes a document whose file is gone, deleting its chunks with it', async () => {
      const k = key('gone');
      await service.sync([file(k)], undefined, req());
      const report = await service.sync([], undefined, req());
      expect(report.removed).toContain(`en/${k}@1`);
      expect((await docsOf(k))[0]?.status).toBe('removed');
      expect(await allChunksOf(k)).toEqual([]);
    });

    it('refuses to go back to an older version than the one in force', async () => {
      const k = key('backwards');
      await service.sync([file(k, { version: 3 })], undefined, req());
      await expect(service.sync([file(k, { version: 2 })], undefined, req())).rejects.toThrow(
        /older than ingested 3/,
      );
    });

    it('records each run as the system, inside PlatformContext', async () => {
      const r = req();
      await service.sync([file(key('audited'))], undefined, r);
      const entries = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, r.correlationId));
      expect(entries.map((e) => e.action).sort()).toEqual(['knowledge.synced', 'platform.access']);
      expect(entries.find((e) => e.action === 'platform.access')?.resourceId).toBe(
        'knowledge.sync',
      );
    });
  });

  describe('embeddings', () => {
    it('leaves every chunk pending without an embedder, and fills them once there is one', async () => {
      const k = key('pending');
      const first = await service.sync([file(k)], undefined, req());
      expect(first.pending).toBeGreaterThan(0);
      const embedder = new HashingEmbedder();
      const second = await service.sync([file(k)], embedder, req());
      expect(second.embedded).toBe(first.pending);
      const [c] = await chunksOf(k);
      expect([c?.embeddingModel, c?.embeddingModelVersion, c?.embedding?.length]).toEqual([
        'test-hashing',
        'input-v1/1536d',
        1536,
      ]);
      expect((await service.sync([file(k)], embedder, req())).embedded).toBe(0);
    });

    it('re-embeds everything when the model or its version changes', async () => {
      const k = key('model');
      await service.sync([file(k)], new HashingEmbedder(), req());
      const report = await service.sync(
        [file(k)],
        new HashingEmbedder('test-hashing', 'input-v2/1536d'),
        req(),
      );
      expect(report.embedded).toBeGreaterThan(0);
      expect((await chunksOf(k))[0]?.embeddingModelVersion).toBe('input-v2/1536d');
    });
  });

  describe('conflicts — flagged, never ranked', () => {
    const openFor = async (a: string, b: string) => {
      const [da] = await docsOf(a);
      const [db] = await docsOf(b);
      const [lo, hi] = [da!.id, db!.id].sort();
      return ownerDb
        .select()
        .from(knowledgeConflicts)
        .where(and(eq(knowledgeConflicts.documentA, lo!), eq(knowledgeConflicts.documentB, hi!)));
    };

    it('flags two current documents asking the same question for the same readers', async () => {
      const [a, b] = [key('same-a'), key('same-b')];
      const report = await service.sync(
        [
          file(a, {}, '## How long does a quote last?\n\nSeven days.\n'),
          file(b, {}, '## how long does a  QUOTE last\n\nFourteen days.\n'),
        ],
        undefined,
        req(),
      );
      expect(report.conflicts).toContainEqual(
        expect.objectContaining({ reason: 'same_question', subject: 'how long does a quote last' }),
      );
      expect((await openFor(a, b)).map((c) => c.status)).toEqual(['open']);
    });

    it('does not flag the same question asked of different readers', async () => {
      const [a, b] = [key('aud-a'), key('aud-b')];
      await service.sync([file(a), file(b, { audience: 'investigator' })], undefined, req());
      expect(await openFor(a, b)).toEqual([]);
    });

    it('flags a public document against any audience — everyone reads the public one', async () => {
      const [a, b] = [key('pub-a'), key('pub-b')];
      await service.sync(
        [file(a), file(b, { audience: 'public', visibility: 'public', folder: 'policies' })],
        undefined,
        req(),
      );
      expect(await openFor(a, b)).toHaveLength(1);
    });

    it('flags two answers whose embeddings are nearly the same, whatever they are headed', async () => {
      const [a, b] = [key('near-a'), key('near-b')];
      // An answer of a real answer's length, so the differing headings are a small share of it.
      const letter = (n: number) => String.fromCharCode(97 + (n % 26));
      const answer = Array.from({ length: 200 }, (_, n) => `w${letter(n)}${letter(n / 26)}`).join(
        ' ',
      );
      const report = await service.sync(
        [
          file(a, {}, `## How long is a quote valid?\n\n${answer}\n`),
          file(b, {}, `## When does a quote expire?\n\n${answer}\n`),
        ],
        new HashingEmbedder(),
        req(),
      );
      expect(report.conflicts).toContainEqual(
        expect.objectContaining({ reason: 'near_duplicate' }),
      );
    });

    it('closes a conflict once the documents stop overlapping', async () => {
      const [a, b] = [key('close-a'), key('close-b')];
      await service.sync([file(a), file(b)], undefined, req());
      await service.sync(
        [file(a), file(b, { version: 2 }, '## Something else entirely?\n\nYes.\n')],
        undefined,
        req(),
      );
      const [row] = await ownerDb
        .select()
        .from(knowledgeConflicts)
        .where(
          eq(
            knowledgeConflicts.documentA,
            [(await docsOf(a))[0]!.id, (await docsOf(b))[0]!.id].sort()[0]!,
          ),
        );
      expect([row?.status, row?.resolvedAt !== null]).toEqual(['resolved', true]);
    });

    it('sets aside an overlap someone reviewed at these versions, and flags it again at the next', async () => {
      const [a, b] = [key('rev-a'), key('rev-b')];
      const reviewed = [
        {
          subject: 'how long does a quote last',
          documents: [`${b}@1`, `${a}@1`] as [string, string],
        },
      ];
      const first = await service.sync([file(a), file(b)], undefined, req(), reviewed);
      expect(first.reviewed).toBe(1);
      expect(first.conflicts.filter((c) => c.subject === 'how long does a quote last')).toEqual([]);

      const next = await service.sync(
        [file(a), file(b, { version: 2 })],
        undefined,
        req(),
        reviewed,
      );
      expect(next.conflicts).toContainEqual(
        expect.objectContaining({ subject: 'how long does a quote last' }),
      );
    });
  });

  describe('the database holds the rules without the sync', () => {
    const current = async () => {
      const k = key('db');
      await service.sync([file(k)], undefined, req());
      return (await docsOf(k))[0]!;
    };

    it('lets any workspace read the platform’s knowledge, and no workspace write it', async () => {
      const doc = await current();
      const { actor } = await member(owner);
      const read = await inWorkspaceOf(
        owner,
        actor.userId,
        async () =>
          await scopedDb(sql)
            .select()
            .from(knowledgeDocuments)
            .where(eq(knowledgeDocuments.id, doc.id)),
      );
      expect(read).toHaveLength(1);
      await expect(
        inWorkspaceOf(
          owner,
          actor.userId,
          async () =>
            await scopedDb(sql)
              .delete(knowledgeChunks)
              .where(eq(knowledgeChunks.documentId, doc.id))
              .returning(),
        ),
      ).resolves.toEqual([]);
      await expect(
        inWorkspaceOf(
          owner,
          actor.userId,
          async () =>
            await scopedDb(sql).insert(knowledgeChunks).values({
              documentId: doc.id,
              ordinal: 99,
              heading: 'x',
              content: 'Planted',
              contentHash: 'x',
              visibility: 'public',
              locale: 'en',
            }),
        ),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringMatching(/row-level security/) }),
      });
    });

    it('gives a chunk its document’s audience and language, whatever the insert claims', async () => {
      // Retrieval filters on the chunk's visibility; a staff answer stored as public would be
      // served to anyone. The trigger copies it from the document, so no writer can widen it.
      const k = key('narrow');
      await service.sync([file(k, { audience: 'staff', visibility: 'staff' })], undefined, req());
      const [doc] = await docsOf(k);
      const [planted] = await owner<{ visibility: string; locale: string }[]>`
        INSERT INTO knowledge_chunks (document_id, ordinal, heading, content, content_hash, visibility, locale)
        VALUES (${doc!.id}, 9, 'q', 'a', 'h', 'public', 'hy') RETURNING visibility, locale`;
      expect(planted).toEqual({ visibility: 'staff', locale: 'en' });
    });

    it('refuses to retire a document that still has chunks', async () => {
      const doc = await current();
      await expect(
        owner`UPDATE knowledge_documents SET status = 'superseded', retired_at = now() WHERE id = ${doc.id}`,
      ).rejects.toThrow(/chunks before it stops being current/);
    });

    it('gives only a current document chunks, and never changes a chunk’s text', async () => {
      const doc = await current();
      await owner`DELETE FROM knowledge_chunks WHERE document_id = ${doc.id}`;
      await owner`UPDATE knowledge_documents SET status = 'superseded', retired_at = now() WHERE id = ${doc.id}`;
      await expect(
        owner`INSERT INTO knowledge_chunks (document_id, ordinal, heading, content, content_hash, visibility, locale)
              VALUES (${doc.id}, 0, 'q', 'a', 'h', 'public', 'en')`,
      ).rejects.toThrow(/only a current document has chunks/);

      const live = await current();
      const [c] = await ownerDb
        .select()
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.documentId, live.id));
      await expect(
        owner`UPDATE knowledge_chunks SET content = 'rewritten' WHERE id = ${c!.id}`,
      ).rejects.toThrow(/changes only by replacing the chunk/);
    });

    it('never holds a document from outside the knowledge base, whatever writes it', async () => {
      await expect(
        owner`INSERT INTO knowledge_documents (doc_key, locale, version, status, title, audience, visibility,
                                               source_of_truth, source_path, updated_on, content_hash)
              VALUES ('kb-ops', 'en', 1, 'current', 'Escalation', 'staff', 'staff', 'docs',
                      'docs/operations/escalation.md', current_date, 'h')`,
      ).rejects.toThrow(/knowledge_documents_from_knowledge_base/);
    });

    it('refuses an embedding that does not say which model made it', async () => {
      const doc = await current();
      const [c] = await ownerDb
        .select()
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.documentId, doc.id));
      const vector = `[${new Array(1536).fill(0.01).join(',')}]`;
      await expect(
        owner`UPDATE knowledge_chunks SET embedding = ${vector}::vector WHERE id = ${c!.id}`,
      ).rejects.toThrow(/knowledge_chunks_embedding_attributed/);
    });
  });
});
