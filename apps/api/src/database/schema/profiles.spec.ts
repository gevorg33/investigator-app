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
    return [...c.indexes.map((i) => i.config.name), ...c.uniqueConstraints.map((u) => u.name)];
  };

  it('allows one customer profile per user', () => {
    expect(indexNames(customerProfiles)).toContain('customer_profiles_user_unique');
  });

  it('allows one investigator profile per user', () => {
    // The account holds both roles; it does not hold two investigator profiles.
    expect(indexNames(investigatorProfiles)).toContain('investigator_profiles_user_unique');
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
    const fk = getTableConfig(investigatorSpecialties).foreignKeys.find((f) =>
      f.reference().foreignTable === taxonomyNodes,
    );
    expect(fk?.onDelete).toBe('restrict');
  });

  it('does cascade a profile away with its user', () => {
    const fk = getTableConfig(investigatorLanguages).foreignKeys[0];
    expect(fk?.onDelete).toBe('cascade');
  });
});
