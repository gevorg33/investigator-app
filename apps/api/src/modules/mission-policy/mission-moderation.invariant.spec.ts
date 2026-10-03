import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MISSION_STATUSES, MISSION_TRANSITIONS } from '../missions/mission-transitions';

/**
 * "A mission cannot reach QUOTED by any path except a moderator publishing it" (T-051), held three
 * ways that together leave no other path:
 *
 * 1. the transition map lets only `STAFF:MODERATION` move a mission into QUOTED, and only from
 *    UNDER_REVIEW (here, and generated in full in mission-transitions.spec.ts);
 * 2. only the transition service writes `missions.status` (mission-status-writes.spec.ts), and it
 *    checks the performer's scope before it checks the map;
 * 3. the moderation service is the only code that asks the transition service for a staff move —
 *    so the only code that could ever ask for QUOTED as `STAFF:MODERATION`.
 *
 * Behaviour is in mission-moderation.service.spec.ts: a customer, a system move, and staff with
 * every other scope are each refused.
 */
const SRC = join(__dirname, '..', '..');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  source: readFileSync(path, 'utf8'),
}));

describe('only a moderator publishes a mission', () => {
  it('lets nobody but STAFF:MODERATION move a mission into QUOTED, and only out of review', () => {
    const into = MISSION_STATUSES.flatMap((from) =>
      (MISSION_TRANSITIONS[from].QUOTED ?? []).map((by) => `${from}:${by}`),
    );
    expect(into).toEqual(['UNDER_REVIEW:STAFF:MODERATION']);
  });

  it('has one caller asking the mission transition service for a staff move: the moderation service', () => {
    const staffMovers = files
      .filter((f) => f.source.includes('MissionTransitionService'))
      .filter((f) => !f.path.endsWith('mission-transition.service.ts'))
      .filter((f) => /kind:\s*'STAFF'/.test(f.source))
      .map((f) => f.path);
    expect(staffMovers).toEqual(['modules/mission-policy/mission-moderation.service.ts']);
  });

  it('found the source to check', () => {
    expect(files.some((f) => f.path === 'modules/missions/missions.service.ts')).toBe(true);
    expect(files.some((f) => f.path === 'modules/quotes/quotes.service.ts')).toBe(true);
  });
});
