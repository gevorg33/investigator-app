import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { teamMembers, teams } from './teams';

/** What a team and its membership rows hold to, by key (T-086). */
describe('the teams tables', () => {
  const keys = (table: typeof teams | typeof teamMembers) =>
    getTableConfig(table)
      .foreignKeys.map((fk) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c) => c.name),
          to: getTableConfig(ref.foreignTable).name,
          foreignColumns: ref.foreignColumns.map((c) => c.name),
          onDelete: fk.onDelete,
        };
      })
      .sort((a, b) => a.columns.join().localeCompare(b.columns.join()));

  it('keep a team to its agency', () => {
    expect(keys(teams)).toEqual([
      { columns: ['tenant_id'], to: 'tenants', foreignColumns: ['id'], onDelete: 'cascade' },
    ]);
  });

  it('keep a membership row to a team and a member of the same agency', () => {
    expect(keys(teamMembers)).toEqual([
      {
        columns: ['membership_id', 'tenant_id'],
        to: 'tenant_memberships',
        foreignColumns: ['id', 'tenant_id'],
        onDelete: 'cascade',
      },
      {
        columns: ['team_id', 'tenant_id'],
        to: 'teams',
        foreignColumns: ['id', 'tenant_id'],
        onDelete: 'cascade',
      },
    ]);
  });
});
