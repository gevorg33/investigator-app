import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { userIdentities } from './identities';
import { userTokens } from './tokens';
import { userStaffScopes } from './staff-scopes';
import { taxonomyNodeLabels, taxonomyNodes } from './taxonomy';
import { assignments } from './assignments';
import { investigationSources } from './investigation-sources';
import { userRoles, users, userSessions } from './users';

/**
 * Rows that exist only because of a user. The cascade is a retention property as much as
 * a relational one: docs/compliance/retention.md says these go with the account.
 */
describe('rows that belong to a user', () => {
  it.each([
    ['user_roles', userRoles],
    ['user_sessions', userSessions],
    ['user_identities', userIdentities],
    ['user_tokens', userTokens],
  ] as Array<[string, PgTable]>)('%s references users and is removed with them', (_name, table) => {
    const fk = getTableConfig(table).foreignKeys.find((f) => f.reference().foreignTable === users);
    expect(fk?.reference().columns.map((c) => c.name)).toEqual(['user_id']);
    expect(fk?.onDelete).toBe('cascade');
  });
});

describe('staff scope grants', () => {
  const fks = getTableConfig(userStaffScopes).foreignKeys.map((f) => ({
    column: f.reference().columns[0]?.name,
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

  it('removes a scope with the staff member who holds it', () => {
    expect(fks).toContainEqual({ column: 'user_id', target: users, onDelete: 'cascade' });
  });

  it.each(['granted_by', 'revoked_by'])(
    'keeps the grant history when the staff member in %s is deleted',
    (column) => {
      // Cascading here would erase who granted or revoked access the moment that person's
      // account went — and revoked grants are kept seven years precisely so an incident
      // review can ask who could see payments last March (docs/compliance/retention.md).
      expect(fks).toContainEqual({ column, target: users, onDelete: 'set null' });
    },
  );
});

describe('taxonomy labels', () => {
  it('belong to a node, and stop the node being removed — nodes are retired, never deleted', () => {
    // Restrict, not cascade: a node with labels is a node someone has used (ADR-0007 rule 1).
    const [fk] = getTableConfig(taxonomyNodeLabels).foreignKeys;
    expect(fk?.reference().foreignTable).toBe(taxonomyNodes);
    expect(fk?.reference().columns.map((c) => c.name)).toEqual(['node_id']);
    expect(fk?.onDelete).toBe('restrict');
  });
});

describe('investigation sources', () => {
  const fks = getTableConfig(investigationSources).foreignKeys.map((f) => ({
    columns: f.reference().columns.map((c) => c.name),
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

  it('stay on their assignment, which cannot be deleted from under them (T-031)', () => {
    // Restrict, as for the assignment's own history: a source is part of the record of the work.
    expect(fks).toContainEqual({
      columns: ['assignment_id'],
      target: assignments,
      onDelete: 'restrict',
    });
    expect(fks).toContainEqual({
      columns: ['assignment_id', 'customer_tenant_id', 'supplier_tenant_id'],
      target: assignments,
      onDelete: 'restrict',
    });
  });

  it('keep who recorded them, even if that account goes', () => {
    expect(fks).toContainEqual({ columns: ['added_by'], target: users, onDelete: 'restrict' });
  });
});
