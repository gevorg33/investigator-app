import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { tenantInvitations } from './employees';

/** What an invitation holds to, by key (T-085). */
describe('the invitations table', () => {
  it('keeps an invitation to an agency, a catalog role and the people who sent and used it', () => {
    const keys = getTableConfig(tenantInvitations)
      .foreignKeys.map((fk) => {
        const ref = fk.reference();
        return {
          columns: ref.columns.map((c) => c.name),
          to: getTableConfig(ref.foreignTable).name,
          onDelete: fk.onDelete,
        };
      })
      .sort((a, b) => a.columns.join().localeCompare(b.columns.join()));
    expect(keys).toEqual([
      { columns: ['accepted_by'], to: 'users', onDelete: 'restrict' },
      { columns: ['invited_by'], to: 'users', onDelete: 'restrict' },
      { columns: ['role_id'], to: 'roles', onDelete: 'restrict' },
      { columns: ['tenant_id', 'tenant_kind'], to: 'tenants', onDelete: 'cascade' },
    ]);
  });
});
