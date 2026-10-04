import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * "Every retention deletion path checks for an active hold first" (T-035), held against the source.
 *
 * Retention deletes through `RetentionGuard.sweep()`, which sees every hold in force and keeps what
 * they cover. Any other delete is a decision someone made about a row — a person removing their own
 * thing, a set being replaced — and is listed below with that reason. A new delete fails here until
 * it is either moved into the guard or listed, so retention cannot start deleting by habit.
 *
 * Parsed with the TypeScript compiler: a database delete is a `.delete(table)` on a database handle,
 * which is how a service method that happens to be called `delete` is told apart from one.
 */
const SRC = join(__dirname, '..', '..');
const GUARD = 'modules/legal-hold/retention-guard.ts';

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'migrations' ? [] : files(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path] : [];
  });

const sources = files(SRC).map((path) => ({
  path: relative(SRC, path),
  source: ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true),
}));

/** A database handle: a transaction, the client, or the service's own. */
const isDatabase = (receiver: string) =>
  receiver === 'tx' || receiver === 'db' || receiver.endsWith('.db');

describe('retention deletes only through the guard (T-035)', () => {
  it('found the source to check', () => {
    expect(sources.some((s) => s.path === GUARD)).toBe(true);
    expect(sources.length).toBeGreaterThan(50);
  });

  it('lists every database delete outside the guard, with why it is not retention', () => {
    const deletes: string[] = [];
    for (const { path, source } of sources) {
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'delete' &&
          isDatabase(node.expression.expression.getText(source).replace(/\s+/g, ''))
        ) {
          deletes.push(`${path} ${node.arguments[0]?.getText(source) ?? ''}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(deletes.sort()).toEqual([
      // A person erasing their own assistant session, which walks every table referencing it
      // (T-045). An erasure, not retention — whether a legal hold must stop it is T-206's to decide.
      'modules/ai-sessions/ai-sessions.service.ts table',
      // A person unlinking their Google sign-in from their own account (T-062).
      'modules/auth/google-auth.service.ts userIdentities',
      // A person unblocking someone (T-052); the fact stays in audit_logs.
      'modules/blocks/blocks.service.ts userBlocks',
      // Derived data: a document's chunks, rebuilt from the document on every sync (T-016).
      'modules/knowledge/knowledge-sync.service.ts knowledgeChunks',
      'modules/knowledge/knowledge-sync.service.ts knowledgeChunks',
      // A draft's own suggested tags, replaced by the customer while editing (T-055).
      'modules/missions/missions.service.ts missionTags',
      // An investigator's languages, specialties and hours, replaced as a set on save (T-007, T-087).
      'modules/profiles/profile-store.ts investigatorAvailability',
      'modules/profiles/profile-store.ts investigatorLanguages',
      'modules/profiles/profile-store.ts investigatorSpecialties',
      // A saved search its owner removed (T-054).
      'modules/search/mission-browse.service.ts savedMissionSearches',
      // A service area its investigator removed (T-009).
      'modules/service-areas/service-areas.service.ts serviceAreas',
      // A team and its membership, removed by the agency (T-086).
      'modules/teams/teams.service.ts teamMembers',
      'modules/teams/teams.service.ts teams',
      // A membership's roles, replaced as a set; the membership itself is kept (T-085).
      'modules/tenants/employees/employee-roles.ts membershipRoles',
      'modules/tenants/employees/employee-roles.ts membershipRoles',
    ]);
  });

  it('writes no DELETE statement by hand anywhere but the guard', () => {
    const offenders = sources
      .filter(({ path }) => path !== GUARD)
      .filter(({ source }) => /\bDELETE\s+FROM\b/i.test(source.getFullText()))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });
});
