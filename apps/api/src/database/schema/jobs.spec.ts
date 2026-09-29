import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { jobRuns } from './jobs';

/** What a job run holds to, by key (T-082). */
describe('job runs', () => {
  it('belong to a workspace that cannot be deleted from under them', () => {
    const [fk] = getTableConfig(jobRuns).foreignKeys;
    const ref = fk!.reference();
    expect({
      columns: ref.columns.map((c) => c.name),
      to: getTableConfig(ref.foreignTable).name,
      foreignColumns: ref.foreignColumns.map((c) => c.name),
      onDelete: fk!.onDelete,
    }).toEqual({
      columns: ['tenant_id'],
      to: 'tenants',
      foreignColumns: ['id'],
      onDelete: 'restrict',
    });
  });
});
