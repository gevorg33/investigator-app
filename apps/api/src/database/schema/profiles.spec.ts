import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  customerProfiles,
  investigatorAvailability,
  investigatorLanguages,
  investigatorProfiles,
  investigatorSpecialties,
} from './profiles';
import { taxonomyNodes } from './taxonomy';
import { users } from './users';

/**
 * The declared shape, asserted rather than assumed.
 *
 * These constraints are what make "one profile per user" and "a specialty is a real node"
 * true regardless of which code path writes the row — so they are worth pinning down, and a
 * migration that quietly drops one should fail here.
 */
describe('profile table shape', () => {
  const indexNames = (t: Parameters<typeof getTableConfig>[0]): string[] => {
    const c = getTableConfig(t);
    return [
      ...c.indexes.map((i) => i.config.name),
      ...c.uniqueConstraints.map((u) => u.name),
    ].filter((n): n is string => n !== undefined);
  };

  it('allows one customer profile per user', () => {
    expect(indexNames(customerProfiles)).toContain('customer_profiles_user_unique');
  });

  it('allows one investigator profile per person per workspace (T-076)', () => {
    // Was one per person. An agency runs profiles for its members, and the same person may hold
    // one in their Personal workspace and another in an agency — never two in one workspace.
    expect(indexNames(investigatorProfiles)).toContain('investigator_profiles_tenant_user_unique');
    expect(indexNames(investigatorProfiles)).not.toContain('investigator_profiles_user_unique');
  });

  it('indexes what discovery filters on', () => {
    expect(indexNames(investigatorProfiles)).toContain('investigator_profiles_visibility_idx');
  });

  it('allows a language to be declared once per profile', () => {
    expect(indexNames(investigatorLanguages)).toContain('investigator_languages_unique');
  });

  it('allows a specialty to be declared once per profile', () => {
    expect(indexNames(investigatorSpecialties)).toContain('investigator_specialties_unique');
  });

  it('indexes specialties by node, which is how matching joins', () => {
    expect(indexNames(investigatorSpecialties)).toContain('investigator_specialties_node_idx');
  });

  it('indexes availability by profile', () => {
    expect(indexNames(investigatorAvailability)).toContain('investigator_availability_profile_idx');
  });

  it('keeps taxonomy slugs unique and indexes the tree', () => {
    const names = indexNames(taxonomyNodes);
    expect(names).toContain('taxonomy_nodes_slug_unique');
    expect(names).toContain('taxonomy_nodes_parent_idx');
  });

  it('does not cascade a specialty away with its taxonomy node', () => {
    // Nodes are deprecated, never deleted (ADR-0007). A profile's declared specialty must
    // survive deprecation, so the reference restricts rather than cascades.
    const fk = getTableConfig(investigatorSpecialties).foreignKeys.find(
      (f) => f.reference().foreignTable === taxonomyNodes,
    );
    expect(fk?.onDelete).toBe('restrict');
  });

  // Resolved through reference(), not just read off the key: a delete rule on the wrong
  // target would pass a check that only looks at onDelete.
  const keyOf = (table: Parameters<typeof getTableConfig>[0], column: string) =>
    getTableConfig(table)
      .foreignKeys.map((f) => ({
        column: f.reference().columns[0]?.name,
        target: f.reference().foreignTable,
        onDelete: f.onDelete,
      }))
      .find((k) => k.column === column);

  it.each([
    ['customer_profiles', customerProfiles],
    ['investigator_profiles', investigatorProfiles],
  ] as const)('removes %s with the account', (_name, table) => {
    expect(keyOf(table, 'user_id')).toEqual({
      column: 'user_id',
      target: users,
      onDelete: 'cascade',
    });
  });

  it.each([
    ['investigator_languages', investigatorLanguages],
    ['investigator_specialties', investigatorSpecialties],
    ['investigator_availability', investigatorAvailability],
  ] as const)('removes %s with the investigator profile', (_name, table) => {
    expect(keyOf(table, 'profile_id')).toEqual({
      column: 'profile_id',
      target: investigatorProfiles,
      onDelete: 'cascade',
    });
  });

  it('will not let a taxonomy node be deleted out from under its children', () => {
    // Nodes are deprecated, never deleted (ADR-0007). restrict makes a delete of a parent
    // with children fail rather than orphan or cascade through the tree.
    expect(keyOf(taxonomyNodes, 'parent_id')).toEqual({
      column: 'parent_id',
      target: taxonomyNodes,
      onDelete: 'restrict',
    });
  });
});
