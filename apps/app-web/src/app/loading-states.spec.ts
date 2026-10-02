// @vitest-environment node
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No route-level loading state while the router can lose a refresh under one (T-186).
 *
 * In Next 15, a `loading.*` file above a page sometimes leaves `router.refresh()` uncommitted in the
 * production build: the refreshed payload starts to arrive, the request is cancelled, and the page
 * keeps showing what it showed before the save until a reload (vercel/next.js#86151). It depends on
 * how long the page takes to render on the reader's device, so a passing run proves nothing — T-093
 * hit it on the agency's held profile, 0 of 5. The router fix shipped in Next 16.3.0
 * (vercel/next.js#95391) and was not backported; once the app is on it, this guard lets go and each
 * loading state can come back where it earns its place (`app-web.md`).
 */
const APP = fileURLToPath(new URL('.', import.meta.url));
const NEXT = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    dependencies: Record<string, string>;
  }
).dependencies['next']!;

/** Whether this Next has the router fix: 16.3.0 or later. */
const fixed = (version: string) => {
  const [major, minor] = version.replace(/^\D*/, '').split('.').map(Number) as [number, number];
  return major > 16 || (major === 16 && minor >= 3);
};

describe('route loading states', () => {
  it('reads the fixed release correctly', () => {
    expect(['15.5.25', '16.2.9', '^15.5.27'].map(fixed)).toEqual([false, false, false]);
    expect(['16.3.0', '16.10.1', '17.0.0'].map(fixed)).toEqual([true, true, true]);
  });

  it(`has none while Next is ${NEXT}`, () => {
    const found = globSync('**/loading.{ts,tsx,js,jsx}', { cwd: APP });
    // On a fixed release any may stay; until then, none.
    expect(fixed(NEXT) ? [] : found).toEqual([]);
  });
});
