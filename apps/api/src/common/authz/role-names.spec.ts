import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A decision is made from a permission, never from the name of a tenant role (T-078,
 * docs/architecture/tenancy.md §3).
 *
 * What a role grants is the catalog's business — 41 permissions, 6 roles, 135 grants, seeded
 * from the matrix and read with the membership on every request. A service that branched on
 * `ADMIN` would be a second copy of that catalog, written in code, updated by hand, and wrong
 * the first time the matrix changed. So the names have nowhere to appear:
 *
 * 1. No source outside the catalog may contain `OWNER`, `ADMIN`, `MANAGER`, `AGENCY_STAFF` or
 *    `VIEWER`. `INVESTIGATOR` is exempt as a string, because it is also a **platform** role that
 *    `requireRole` legitimately checks — which is the point of keeping the two vocabularies apart.
 * 2. Only the resolver may read `roles` or `membership_roles` to decide anything. The workspace
 *    switcher reads them to *show* the caller their roles, which is display, not a decision.
 *
 * Together those leave a role name no way into an `if`.
 */
const SRC = join(__dirname, '..', '..');

/** Tenant role keys that carry no other meaning in this codebase. */
const TENANT_ROLE_NAMES = ['OWNER', 'ADMIN', 'MANAGER', 'AGENCY_STAFF', 'VIEWER'];

/** The catalog itself, and the one place that may name a role to display it. */
const MAY_NAME_A_ROLE = ['database/schema/tenants.ts'];

/** Reading the role tables: deciding (the resolver) and showing (the switcher). */
const MAY_READ_ROLE_TABLES = [
  'common/context/workspace.resolver.ts',
  'modules/tenants/workspaces.service.ts',
  // Creating a workspace assigns its owner's role. That is a write of the catalog's own role —
  // constrained by the policy to that one role — not a decision made from a name (T-083).
  'modules/tenants/agencies.service.ts',
  'database/schema/index.ts',
  'database/schema/tenants.ts',
  'database/table-classes.ts',
];

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [path] : [];
  });

/** Comments are where these names are explained; the rule is about code. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const sources = files(SRC).map((path) => ({
  path: relative(SRC, path),
  text: withoutComments(readFileSync(path, 'utf8')),
}));

describe('authorization asks what you may do, never who you are called', () => {
  it('found the source to check', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it('names a tenant role nowhere but the catalog', () => {
    const offenders = sources
      .filter(({ path }) => !MAY_NAME_A_ROLE.includes(path))
      .flatMap(({ path, text }) =>
        TENANT_ROLE_NAMES.filter((role) => new RegExp(`\\b${role}\\b`).test(text)).map(
          (role) => `${path}: ${role}`,
        ),
      );
    expect(offenders).toEqual([]);
  });

  it('reads the role tables only to resolve a request or to show a workspace list', () => {
    const offenders = sources
      .filter(({ path }) => !MAY_READ_ROLE_TABLES.includes(path))
      .filter(
        ({ text }) =>
          /\b(membershipRoles|rolePermissions)\b/.test(text) ||
          /import\s*\{[^}]*\broles\b[^}]*\}\s*from\s*'[^']*database\/schema'/.test(text),
      )
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('asks for permissions through the typed catalog, so a name that does not exist cannot compile', () => {
    // Every requirePermission call site passes a literal; the type is what keeps it real. This
    // records which permissions the application currently depends on, so a seed that dropped one
    // would be a visible change here rather than a check that silently always refuses.
    const asked = sources
      .flatMap(({ text }) => [...text.matchAll(/requirePermission\(actor, '([^']+)'/g)])
      .map((m) => m[1]!)
      .sort();
    expect([...new Set(asked)]).toEqual([
      'investigations.create',
      'investigations.read',
      'investigations.update',
      'investigators.read',
      'investigators.update',
    ]);
  });
});
