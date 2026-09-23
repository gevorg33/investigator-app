import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../src');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );

/**
 * A cursor never compares a timestamp column directly with a value it decoded (T-134).
 *
 * PostgreSQL keeps microseconds; a cursor round-trips through a JavaScript Date, which keeps
 * milliseconds. Compared directly, oldest-first paging repeats its last row forever — the
 * verification queue never got past page two — and newest-first paging silently skips rows. It was
 * written three times before this rule existed. Compare on `date_trunc('milliseconds', column)`
 * instead, as `docs/api/pagination.md` says.
 */
describe('cursor precision', () => {
  const sources = walk(SRC)
    .filter((f) => !f.endsWith('.spec.ts'))
    .map((path) => ({ path: relative(SRC, path), source: readFileSync(path, 'utf8') }));

  it('found the paged services', () => {
    expect(sources.filter((f) => /after\.[a-z]\w*At\b/.test(f.source)).length).toBeGreaterThan(2);
  });

  it('compares no timestamp column with a decoded cursor value directly', () => {
    const direct = sources.flatMap((f) =>
      [...f.source.matchAll(/\b(?:gt|gte|lt|lte|eq)\(\s*\w+\.\w+At\s*,\s*after\.\w+At\b/g)].map(
        (m) => `${f.path}: ${m[0].replace(/\s+/g, ' ')}`,
      ),
    );
    expect(direct).toEqual([]);
  });
});
