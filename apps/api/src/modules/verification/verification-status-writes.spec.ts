import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `investigator_profiles.verification_status` has one writer: the verification service.
 *
 * It is the column discovery and quoting refuse on. A status set anywhere else has no
 * application and no decision behind it — an investigator listed on nobody's say-so, with
 * nothing to show a later dispute or audit. Held against the source itself, as the mission and
 * assignment status machines are.
 */
const SRC = join(__dirname, '..', '..');
const WRITER = join('modules', 'verification', 'verification.service.ts');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

describe('only the verification service writes a verification status', () => {
  it('found the source to check', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.path.endsWith(WRITER))).toBe(true);
  });

  it('has no UPDATE on investigator profiles that sets it, anywhere else', () => {
    const offenders = files
      .filter((f) => !f.path.endsWith(WRITER))
      .filter((f) =>
        /update\(\s*investigatorProfiles\s*\)[\s\S]{0,400}?verificationStatus\s*:/.test(f.source),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('never creates a profile holding a chosen status', () => {
    // A profile begins UNVERIFIED by column default. Creating one in any other state would be
    // verification an account arrived holding — the one thing it must never do.
    const offenders = files
      .filter((f) =>
        /insert\(\s*investigatorProfiles\s*\)[\s\S]{0,600}?verificationStatus\s*:/.test(f.source),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('has no raw SQL that sets it', () => {
    const offenders = files
      .filter((f) =>
        /UPDATE\s+"?investigator_profiles"?\s+SET[^;]*verification_status/i.test(f.source),
      )
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps the verification service as the one place that does write it', () => {
    const writer = files.find((f) => f.path.endsWith(WRITER));
    expect(writer?.source).toMatch(
      /update\(investigatorProfiles\)[\s\S]{0,200}?verificationStatus: 'VERIFIED'/,
    );
    expect(writer?.source).toMatch(
      /update\(investigatorProfiles\)[\s\S]{0,200}?verificationStatus: 'REJECTED'/,
    );
    expect(writer?.source).toMatch(
      /update\(investigatorProfiles\)[\s\S]{0,200}?verificationStatus: 'PENDING'/,
    );
  });
});
