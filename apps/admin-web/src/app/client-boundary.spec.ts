// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * A server component may take only **components** from a `'use client'` module (T-205).
 *
 * Across that boundary every export becomes a client reference: a component renders, but an array
 * or a constant arrives as something that is not one — `RESOURCES.find is not a function`, on the
 * legal-holds page, found in the browser after every spec had passed. jsdom has no boundary, so no
 * render test can see it; this reads the imports instead. A value both sides need lives in a plain
 * module that each imports for itself.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return /\.tsx?$/.test(e.name) && !/\.spec\.tsx?$/.test(e.name) ? [path] : [];
  });

const isClient = (text: string) => /^\s*(['"])use client\1/.test(text);

/** `@/x` and relative specifiers, to a file on disk; anything else is a package, not ours. */
const resolveImport = (from: string, spec: string): string | undefined => {
  const base = spec.startsWith('@/')
    ? join(SRC, spec.slice(2))
    : spec.startsWith('.')
      ? resolve(dirname(from), spec)
      : undefined;
  if (base === undefined) return undefined;
  return ['.tsx', '.ts', '/index.tsx', '/index.ts'].map((x) => base + x).find(existsSync);
};

/** A component is named in PascalCase; anything else crossing the boundary is a value. */
const isComponentName = (name: string) => /^[A-Z][a-z0-9]/.test(name) && !/^[A-Z0-9_]+$/.test(name);

describe('the server/client boundary', () => {
  const sources = files(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

  it('found the source to check', () => {
    expect(sources.some((s) => isClient(s.text))).toBe(true);
    expect(sources.some((s) => !isClient(s.text))).toBe(true);
  });

  it('gives a server component nothing from a client module but components', () => {
    const offenders: string[] = [];
    for (const { path, text } of sources.filter((s) => !isClient(s.text))) {
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
        const target = resolveImport(path, (statement.moduleSpecifier as ts.StringLiteral).text);
        if (target === undefined || !isClient(readFileSync(target, 'utf8'))) continue;
        const named = statement.importClause?.namedBindings;
        if (named === undefined || !ts.isNamedImports(named)) continue;
        for (const el of named.elements) {
          if (el.isTypeOnly) continue;
          const name = (el.propertyName ?? el.name).text;
          if (!isComponentName(name)) offenders.push(`${relative(SRC, path)}: ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
