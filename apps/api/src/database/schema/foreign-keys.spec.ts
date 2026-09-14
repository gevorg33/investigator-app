import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { userIdentities } from './identities';
import { userTokens } from './tokens';
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
