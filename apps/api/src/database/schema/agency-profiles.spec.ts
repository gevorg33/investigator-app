import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { tenantProfiles, tenantSettings } from './agency-profiles';
import { mediaAssets } from './media';
import { tenants } from './tenants';

/** What the new tables hold to, by key (T-084). */
describe('agency profile and settings tables', () => {
  const keys = (table: typeof tenantProfiles | typeof tenantSettings) =>
    getTableConfig(table).foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        name: fk.getName(),
        columns: ref.columns.map((c) => c.name),
        to: getTableConfig(ref.foreignTable).name,
        foreignColumns: ref.foreignColumns.map((c) => c.name),
        onDelete: fk.onDelete,
      };
    });

  it('keep a profile to an agency, and its images to that agency’s own files', () => {
    expect(keys(tenantProfiles)).toEqual([
      {
        name: 'tenant_profiles_tenant_kind_fk',
        columns: ['tenant_id', 'tenant_kind'],
        to: getTableConfig(tenants).name,
        foreignColumns: ['id', 'kind'],
        onDelete: 'restrict',
      },
      {
        name: 'tenant_profiles_logo_fk',
        columns: ['logo_media_id', 'tenant_id'],
        to: getTableConfig(mediaAssets).name,
        foreignColumns: ['id', 'tenant_id'],
        onDelete: 'restrict',
      },
      {
        name: 'tenant_profiles_cover_fk',
        columns: ['cover_media_id', 'tenant_id'],
        to: getTableConfig(mediaAssets).name,
        foreignColumns: ['id', 'tenant_id'],
        onDelete: 'restrict',
      },
    ]);
  });

  it('keep settings to their workspace, which they never outlive by accident', () => {
    expect(keys(tenantSettings)).toEqual([
      {
        name: 'tenant_settings_tenant_id_tenants_id_fk',
        columns: ['tenant_id'],
        to: 'tenants',
        foreignColumns: ['id'],
        onDelete: 'restrict',
      },
    ]);
  });
});
