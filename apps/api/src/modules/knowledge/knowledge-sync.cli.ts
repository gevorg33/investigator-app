import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AuditModule } from '../../common/audit/audit.module';
import { PlatformContext } from '../../common/context/platform-context';
import { DatabaseModule } from '../../database/database.module';
import { EMBEDDING_DIMENSIONS } from '../../database/schema';
import { type Embedder, OpenAiEmbedder } from './embedder';
import { KnowledgeSourceError, readKnowledgeBase, readReviewedOverlaps } from './knowledge-source';
import { KnowledgeSyncService } from './knowledge-sync.service';
import { gitLastChanged, staleDocuments } from './staleness';

/**
 * Just what the sync needs, through the application's own database module — so the command gets
 * the scoped client, and refuses to start as a role row-level security would not apply to, exactly
 * as the API does (T-073).
 */
@Module({
  imports: [DatabaseModule, AuditModule],
  providers: [PlatformContext, KnowledgeSyncService],
})
export class KnowledgeSyncCommandModule {}

export interface CliOptions {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  out: (line: string) => void;
  /** Injected in tests; git in real use. */
  lastChanged?: (root: string) => (path: string) => string | null;
  /** Injected in tests; the OpenAI adapter in real use, when a key is configured. */
  embedder?: Embedder | undefined;
}

/**
 * `pnpm --filter api knowledge:sync [--fail-on-conflict] [--staleness] [--root <repo>]` (T-016).
 *
 * Makes the database's knowledge base match the repository's and prints what it did. Run by CI
 * against the database it migrated from empty, so a document the pipeline cannot ingest fails the
 * pull request that added it; each deploy runs it after migrating (T-040). Idempotent: a second
 * run changes nothing.
 *
 * Without `OPENAI_API_KEY` it still ingests everything — searchable by text — and leaves the
 * embeddings pending until a key exists (ACTIONS-FOR-ME #6).
 *
 * Connects with `DATABASE_URL`, as the API does. Returns the exit code rather than exiting, so it
 * can be tested.
 */
export async function runKnowledgeSync(opts: CliOptions): Promise<number> {
  const flag = (name: string) => opts.argv.includes(name);
  const rootAt = opts.argv.indexOf('--root');
  const root =
    rootAt === -1 ? resolve(opts.cwd, '../..') : resolve(opts.cwd, opts.argv[rootAt + 1]!);

  let source;
  let reviewed;
  try {
    source = readKnowledgeBase(root);
    reviewed = readReviewedOverlaps(root);
  } catch (e) {
    if (!(e instanceof KnowledgeSourceError)) throw e;
    opts.out(`knowledge: refused — ${e.message}`);
    return 1;
  }

  const key = opts.env['OPENAI_API_KEY'];
  const embedder =
    opts.embedder ??
    (key
      ? new OpenAiEmbedder(
          key,
          opts.env['OPENAI_EMBEDDING_MODEL'] ?? 'text-embedding-3-small',
          EMBEDDING_DIMENSIONS,
        )
      : undefined);
  if (embedder === undefined) {
    opts.out('knowledge: no OPENAI_API_KEY — ingesting without embeddings; they stay pending');
  }

  // `abortOnError: false`: by default Nest calls process.exit(1) on a startup failure, which with
  // the logger off exits silently. A command should say what went wrong.
  const app = await NestFactory.createApplicationContext(KnowledgeSyncCommandModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const sync = app.get(KnowledgeSyncService);
    const report = await sync.sync(
      source,
      embedder,
      { correlationId: `knowledge-sync-${randomUUID()}` },
      reviewed,
    );

    opts.out(
      `knowledge: ${source.length} documents — ${report.created.length} created, ` +
        `${report.updated.length} updated, ${report.superseded.length} superseded, ` +
        `${report.removed.length} removed, ${report.unchanged} unchanged; ` +
        `${report.embedded} chunks embedded, ${report.pending} pending; ` +
        `${report.conflicts.length} conflicts open, ${report.reviewed} overlaps reviewed`,
    );
    for (const line of [
      ...report.created,
      ...report.updated,
      ...report.superseded,
      ...report.removed,
    ]) {
      opts.out(`  ${line}`);
    }
    for (const c of report.conflicts) {
      opts.out(`  CONFLICT ${c.reason}: "${c.subject}" — ${c.documents[0]} and ${c.documents[1]}`);
    }

    if (flag('--staleness')) {
      const stale = staleDocuments(source, (opts.lastChanged ?? gitLastChanged)(root));
      opts.out(`knowledge: ${stale.length} document references to code changed since the document`);
      for (const s of stale) {
        opts.out(
          `  STALE ${s.sourcePath} (updated ${s.updatedOn}): ${s.path} ` +
            (s.changedOn === null ? 'does not exist' : `changed ${s.changedOn}`),
        );
      }
    }

    return flag('--fail-on-conflict') && report.conflicts.length > 0 ? 1 : 0;
  } finally {
    await app.close();
  }
}
