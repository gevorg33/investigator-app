import { PgDialect, getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { aiMessages, aiSessions } from './ai-sessions';

/** The SQL a generated column is computed from, as the migration writes it. */
const generatedSql = (table: PgTable, column: string): string => {
  const col = getTableConfig(table).columns.find((c) => c.name === column) as unknown as {
    generated?: { as: () => SQL };
  };
  return new PgDialect().sqlToQuery(col.generated!.as()).sql;
};

/**
 * Search indexes words in one configuration, `simple`, for all three languages (T-045): Armenian
 * has no stemmer, and a per-language configuration would need to know a message's language before
 * indexing it. Words match as written; nothing is stemmed away.
 */
describe('what search indexes', () => {
  it('indexes a session’s title, empty when it has none', () => {
    expect(generatedSql(aiSessions, 'title_search')).toMatch(
      /to_tsvector\('simple', coalesce\("ai_sessions"\."title", ''\)\)/,
    );
  });

  it('indexes a message’s words, and nothing for a tool event that has none', () => {
    expect(generatedSql(aiMessages, 'content_search')).toMatch(
      /to_tsvector\('simple', coalesce\("ai_messages"\."content", ''\)\)/,
    );
  });
});
