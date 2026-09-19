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
});
