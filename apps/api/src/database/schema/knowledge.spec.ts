import { PgDialect, getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { knowledgeChunks, knowledgeConflicts, knowledgeDocuments } from './knowledge';

const dialect = new PgDialect();

/** The SQL a generated column is computed from, as the migration writes it. */
const generatedSql = (table: PgTable, column: string): string => {
  const col = getTableConfig(table).columns.find((c) => c.name === column) as unknown as {
    generated?: { as: () => SQL };
  };
  return dialect.sqlToQuery(col.generated!.as()).sql;
};

/** Each foreign key as `column -> table(column)`. */
const references = (table: PgTable) =>
  getTableConfig(table).foreignKeys.map((fk) => {
    const r = fk.reference();
    return `${r.columns.map((c) => c.name).join()} -> ${getTableConfig(r.foreignTable).name}(${r.foreignColumns.map((c) => c.name).join()}) ${fk.onDelete}`;
  });

/** Each partial index's predicate, by name. */
const predicates = (table: PgTable) =>
  Object.fromEntries(
    getTableConfig(table)
      .indexes.filter((i) => i.config.where !== undefined)
      .map((i) => [i.config.name, dialect.sqlToQuery(i.config.where!).sql]),
  );

describe('the knowledge tables (T-016)', () => {
  it('indexes a chunk’s question and answer in the `simple` configuration, for every language', () => {
    expect(generatedSql(knowledgeChunks, 'search')).toMatch(
      /to_tsvector\('simple', "knowledge_chunks"\."heading" \|\| ' ' \|\| "knowledge_chunks"\."content"\)/,
    );
  });

  it('never lets a document be deleted from under its chunks or its conflicts', () => {
    expect(references(knowledgeDocuments)).toEqual(['tenant_id -> tenants(id) restrict']);
    expect(references(knowledgeChunks)).toEqual([
      'document_id -> knowledge_documents(id) restrict',
    ]);
    expect(references(knowledgeConflicts)).toEqual([
      'document_a -> knowledge_documents(id) restrict',
      'document_b -> knowledge_documents(id) restrict',
    ]);
  });

  it('allows one current version of a document per locale, and finds unembedded chunks cheaply', () => {
    expect(predicates(knowledgeDocuments)).toEqual({
      knowledge_documents_one_current: expect.stringMatching(
        /"knowledge_documents"\."status" = 'current'/,
      ),
    });
    expect(predicates(knowledgeChunks)).toEqual({
      knowledge_chunks_pending_idx: expect.stringMatching(
        /"knowledge_chunks"\."embedding" IS NULL/,
      ),
    });
  });
});
