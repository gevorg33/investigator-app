import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Never assign a status field" (mission-state-machine), enforced against the source itself —
 * the same guard the mission machine carries, for the same reason.
 *
 * A status written outside the transition service has no history row, no audit entry and no
 * outbox event. For an assignment that is worse than for a mission: the assignment is the
 * agreement money was taken against, so a status nobody can explain is a dispute nobody can
 * settle.
 */
const SRC = join(__dirname, '..', '..');
const TRANSITION_SERVICE = 'assignment-transition.service.ts';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('only the transition service writes an assignment status', () => {
  it('found the source to check', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.path.endsWith(TRANSITION_SERVICE))).toBe(true);
  });

  it('has no UPDATE on assignments that sets a status, anywhere else', () => {
    const offenders = files
      .filter((f) => !f.path.endsWith(TRANSITION_SERVICE))
      .filter((f) => /update\(\s*assignments\s*\)[\s\S]{0,400}?status\s*:/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('never inserts an assignment with a chosen status', () => {
    // An assignment begins PENDING_ACCEPTANCE by column default. Creating one in any other
    // state would mean an investigator was committed, or released, without a move anyone can
    // point to.
    const offenders = files
      .filter((f) => /insert\(\s*assignments\s*\)[\s\S]{0,600}?status\s*:/.test(f.source))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps the transition service as the one place that does write it', () => {
    const service = files.find((f) => f.path.endsWith(TRANSITION_SERVICE));
    expect(service?.source).toMatch(/update\(assignments\)[\s\S]{0,400}?status: to/);
  });
});
