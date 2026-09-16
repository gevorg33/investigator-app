import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Never assign a status field" (mission-state-machine) enforced against the source itself.
 *
 * A status written outside the transition service has no history row, no audit entry and no
 * outbox event — which is exactly the state that makes a dispute unresolvable. Review catches
 * that on a good day; this catches it on every day, including in code a later task adds.
 */
const SRC = join(__dirname, '..', '..');
const TRANSITION_SERVICE = 'mission-transition.service.ts';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('only the transition service writes a mission status', () => {
  it('found the source to check', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.path.endsWith(TRANSITION_SERVICE))).toBe(true);
  });

  it('has no UPDATE on missions that sets a status, anywhere else', () => {
    // The service's own draft edit updates content columns in the same way, so the check is
    // "an update that mentions status", not "an update".
    const offenders = files
      .filter((f) => !f.path.endsWith(TRANSITION_SERVICE))
      .filter((f) => /update\(\s*missions\s*\)[\s\S]{0,400}?status\s*:/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('never inserts a mission with a chosen status', () => {
    // A mission begins as a DRAFT by column default. Creating one in any other state would
    // skip the machine entirely.
    const offenders = files
      .filter((f) => /insert\(\s*missions\s*\)[\s\S]{0,400}?status\s*:/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps the transition service as the one place that does write it', () => {
    const service = files.find((f) => f.path.endsWith(TRANSITION_SERVICE));
    expect(service?.source).toMatch(/update\(missions\)[\s\S]{0,400}?status: to/);
  });
});
