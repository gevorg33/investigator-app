import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * No worker path touches a scoped table outside a restored context (T-082).
 *
 * A worker has no request to resolve a workspace from; outside a context, row-level security shows
 * it nothing and refuses its writes — which fails safe, but silently. So in this directory the
 * database is reached in exactly two ways, both checked here by reading the code:
 *
 * - through `this.db`, **only** lexically inside a callback handed to `runInContext` (a job's own
 *   context, restored) or `asSystem` (the audited system context), and awaited there — a Drizzle
 *   query is lazy, and one returned unawaited runs after the context is gone (it happened: the
 *   dead-letter insert, caught by `jobs.queue.spec.ts`);
 * - through the transaction the runner hands a handler — handlers never hold the database at all.
 */
const DIR = __dirname;
const sources = readdirSync(DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
  .map((file) => ({
    file,
    source: ts.createSourceFile(
      file,
      readFileSync(join(DIR, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    ),
  }));

/** Every `this.db` in the directory, with the context-entering call it sits inside, if any. */
function dbUses() {
  const uses: Array<{ file: string; line: number; inside: string | undefined; awaited: boolean }> =
    [];
  for (const { file, source } of sources) {
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.name.text === 'db'
      ) {
        let inside: string | undefined;
        for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
          if (ts.isCallExpression(p)) {
            const callee = p.expression.getText(source);
            if (/(^|\.)(asSystem|runInContext)$/.test(callee)) {
              inside = callee.replace(/^.*\./, '');
              break;
            }
          }
        }
        // `this.db.transaction(…)` starts at once; anything else must be awaited where it stands.
        const chain = node.parent;
        const eager = ts.isPropertyAccessExpression(chain) && chain.name.text === 'transaction';
        let awaited = eager;
        for (let p: ts.Node = node; !awaited && p.parent !== undefined; p = p.parent) {
          if (ts.isAwaitExpression(p.parent)) awaited = true;
          if (ts.isArrowFunction(p.parent) || ts.isExpressionStatement(p.parent)) break;
        }
        uses.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          inside,
          awaited,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return uses;
}

describe('worker paths and the database', () => {
  it('found the runner, the dispatcher and the dead letters reaching it', () => {
    const files = [...new Set(dbUses().map((u) => u.file))].sort();
    expect(files).toEqual(['dead-letters.ts', 'job-runner.ts', 'outbox-dispatcher.ts']);
  });

  it('reaches it only inside a restored context or the system context', () => {
    const outside = dbUses()
      .filter((u) => u.inside === undefined)
      .map((u) => `${u.file}:${u.line}`);
    expect(outside).toEqual([]);
  });

  it('awaits every query where it is made, so it runs in that context', () => {
    const lazy = dbUses()
      .filter((u) => !u.awaited)
      .map((u) => `${u.file}:${u.line}`);
    expect(lazy).toEqual([]);
  });

  it('gives handlers a transaction, never the database', () => {
    const handlers = sources.filter(({ file }) => file.endsWith('.handler.ts'));
    expect(handlers.map((h) => h.file)).toEqual(['outbox-delivery.handler.ts']);
    for (const { file, source } of handlers) {
      expect(source.getFullText(), file).not.toMatch(
        /\bDB\b|database\.module['"]\s*;[\s\S]*\bDb\b(?!\w)/,
      );
      expect(source.getFullText(), file).not.toMatch(/@Inject\(DB\)/);
    }
  });
});
