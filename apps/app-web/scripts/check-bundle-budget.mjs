// Fails the build when a route's initial JavaScript exceeds the application budget
// (frontend-performance: ≤ 250 kB gzipped). Run after `next build`: `pnpm --filter app-web budget`.
//
// A route loads its own entry plus the entry of every layout above it. Those chunk lists are in
// .next/app-build-manifest.json; each file is gzipped here and the union summed, so a chunk two
// layouts share is counted once, as the browser downloads it once.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 250_000;
const next = join(import.meta.dirname, '..', '.next');
const { pages } = JSON.parse(readFileSync(join(next, 'app-build-manifest.json'), 'utf8'));

const gzipped = (file) => gzipSync(readFileSync(join(next, file))).length;

const rows = Object.keys(pages)
  .filter((entry) => entry.endsWith('/page'))
  .map((entry) => {
    const segments = entry.split('/').slice(1, -1);
    const layouts = segments.map((_, i) => `/${segments.slice(0, i + 1).join('/')}/layout`);
    const files = new Set(
      ['/layout', ...layouts, entry]
        .flatMap((e) => pages[e] ?? [])
        .filter((f) => f.endsWith('.js')),
    );
    const bytes = [...files].reduce((sum, f) => sum + gzipped(f), 0);
    // Route groups — `(workspace)` — are folders, not URL segments.
    const route = entry.replace(/\/page$/, '').replace(/\/\([^)]*\)/g, '') || '/';
    return { route, bytes };
  })
  .sort((a, b) => b.bytes - a.bytes);

for (const { route, bytes } of rows) {
  const flag = bytes > BUDGET_BYTES ? '  OVER BUDGET' : '';
  console.log(`${(bytes / 1000).toFixed(1).padStart(7)} kB  ${route}${flag}`);
}
const over = rows.filter((r) => r.bytes > BUDGET_BYTES);
if (rows.length === 0) {
  console.error('No routes found in the build manifest. Run `next build` first.');
  process.exit(1);
}
if (over.length > 0) {
  console.error(`${over.length} route(s) over the ${BUDGET_BYTES / 1000} kB initial JS budget.`);
  process.exit(1);
}
console.log(`All ${rows.length} routes within the ${BUDGET_BYTES / 1000} kB initial JS budget.`);
