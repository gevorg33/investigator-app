import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * CLAUDE.md non-negotiable 16, enforced against the source (T-075).
 *
 * 1. No function, method or constructor takes a `tenantId` (or `tenant_id`, `workspaceId`)
 *    parameter, and no request DTO declares one. The workspace comes from the execution
 *    context; a parameter is a place for a caller to pass the wrong one.
 * 2. Only the database module opens the raw pool or builds a drizzle client — the "unscoped
 *    path", which carries no execution context. Everything else gets DB, which does.
 *
 * The resolver and the switcher take a *requested* workspace — a candidate the client named, to
 * check against memberships, never one to act in — and name it `requested`, so the difference
 * between a candidate and the context is visible at every call site.
 *
 * Parsed with the TypeScript compiler, not matched with a regular expression, so a query builder
 * that merely selects a column named tenantId is not mistaken for a parameter.
 */
const SRC = join(__dirname, '..', '..');
const FORBIDDEN = new Set(['tenantId', 'tenant_id', 'workspaceId', 'workspace_id']);

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path] : [];
  });

const sources = files(SRC).map((path) => ({
  path: relative(SRC, path),
  source: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true),
}));

const nameOf = (n: ts.Node | undefined) =>
  n !== undefined && (ts.isIdentifier(n) || ts.isStringLiteral(n)) ? n.text : undefined;

describe('tenant isolation is not business-domain plumbing', () => {
  it('found the source to check', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('has no function, method or constructor that takes a tenant id', () => {
    const offenders: string[] = [];
    for (const { path, source } of sources) {
      const visit = (node: ts.Node): void => {
        if (ts.isParameter(node) && FORBIDDEN.has(nameOf(node.name) ?? '')) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          offenders.push(`${path}:${line + 1}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  it('declares no tenant id on a request DTO', () => {
    const offenders: string[] = [];
    for (const { path, source } of sources.filter((s) => s.path.endsWith('.dto.ts'))) {
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyDeclaration(node) && FORBIDDEN.has(nameOf(node.name) ?? '')) {
          offenders.push(path);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });

  it('opens the raw pool and builds drizzle clients only in the database module', () => {
    const allowed = new Set(['database/database.module.ts']);
    const offenders = sources
      .filter(({ path }) => !allowed.has(path))
      .filter(({ source }) => {
        const text = source.getFullText();
        return (
          /@Inject\(SQL\)/.test(text) || /\bdrizzle\(/.test(text) || /\bcreatePool\(/.test(text)
        );
      })
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('keeps the database module’s DB provider behind the scoped client', () => {
    const module = sources
      .find((s) => s.path === 'database/database.module.ts')!
      .source.getFullText();
    expect(module).toMatch(/drizzle\(scopedClient\(sql\)/);
  });

  it('raises platform access in one module, and writes the setting in one other', () => {
    // `app.platform_access` is what the policies read to allow a cross-workspace query. The
    // access is held in one module, entered from exactly one other — the one that checks who is
    // asking and audits it — and written to the database by the scoped client alone.
    const allowed = [
      'common/context/platform-access.ts',
      'common/context/platform-context.ts',
      'database/scoped-client.ts',
    ];
    const offenders = sources
      .filter(({ source }) => /platform_access|platformAccess/.test(source.getFullText()))
      .map(({ path }) => path)
      .filter((path) => !allowed.includes(path));
    expect(offenders).toEqual([]);

    // The holder exports the way in; exactly one module calls it, and that module is the one
    // that checks who is asking and writes the audit row first.
    const entered = sources
      .filter(({ source }) => /enterPlatformAccess\(access/.test(source.getFullText()))
      .map(({ path }) => path);
    expect(entered).toEqual(['common/context/platform-context.ts']);
  });

  it('lists every place that crosses workspaces, so a new one is a decision and not a habit', () => {
    // Staff review and system operations are the two reasons to be in PlatformContext at all
    // (T-079 adds the audit and the typed reasons). A path added here has to be added here.
    const callers = sources
      .filter(({ source }) => /\.(asStaff|asSystem)\(/.test(source.getFullText()))
      .filter(({ path }) => path !== 'common/context/platform-context.ts')
      .map(({ path }) => path)
      .sort();
    expect(callers).toEqual([
      'modules/assignments/assignments.service.ts',
      // Moderation staff deciding investigators' policy refusals (T-050, approved 2026-09-23).
      'modules/assignments/policy-refusal.service.ts',
      // The knowledge-base sync, a system operation with no user (T-016, approved 2026-09-23).
      'modules/knowledge/knowledge-sync.service.ts',
      'modules/media/media.service.ts',
      // Moderation staff pre-moderating review words and removing reviews (T-037, approved
      // 2026-09-25). The public list and the parties' own actions do not cross.
      'modules/reviews/reviews.service.ts',
      // Staff maintaining the taxonomy, which is platform data that only a write under platform
      // access may change (T-053, approved 2026-09-23). It reads no workspace's rows.
      'modules/taxonomy/taxonomy.service.ts',
      'modules/verification/verification.service.ts',
    ]);
  });

  it('reads the user’s own workspaces only where a workspace is being chosen', () => {
    // The pre-workspace context is for picking a workspace and for the session that opens in
    // one. Anywhere else it would be a way to read outside the workspace the request is in.
    const callers = sources
      .filter(({ source }) => /\brunAsUser\(/.test(source.getFullText()))
      .map(({ path }) => path)
      .sort();
    expect(callers).toEqual([
      'common/context/workspace.resolver.ts',
      'modules/auth/auth.service.ts',
    ]);
  });

  it('builds a storage path in the storage adapter and nowhere else', () => {
    // A file's folder carries the workspace (T-080). Business code that assembled one would be
    // a second place for the workspace to come from, and the wrong one — the adapter derives it
    // from the execution context.
    const offenders = sources
      // The adapter derives the path; the env schema only validates that the root is configured.
      .filter(
        ({ path }) =>
          path !== 'modules/media/cloudinary.storage.ts' && path !== 'config/env.schema.ts',
      )
      .filter(({ source }) => /CLOUDINARY_FOLDER|`[^`]*tenant\/\$\{/.test(source.getFullText()))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
