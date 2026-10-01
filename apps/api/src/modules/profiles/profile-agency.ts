import { and, eq, inArray } from 'drizzle-orm';
import type { Db, Tx } from '../../database/database.module';
import { tenantProfiles, tenants } from '../../database/schema';
import type { ProfileAgency } from './profile.projection';

/**
 * The agency behind each workspace that is one (T-087), keyed by workspace id. A Personal
 * workspace is absent from the map: its profiles belong to no agency.
 *
 * The name is the one the agency shows the public — its published profile's display name — and
 * otherwise its registered name, which is what a customer would be dealing with anyway. A draft
 * agency profile's name is never used, even when the reader is inside the agency, so a preview
 * shows exactly what a customer will see.
 *
 * The workspace rows are readable wherever the profile is: inside the workspace by membership, and
 * from any other while one of its profiles is published (`listing_read`, migration 0037).
 */
export async function agenciesOf(
  db: Db | Tx,
  tenantIds: readonly string[],
): Promise<Map<string, ProfileAgency>> {
  if (tenantIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      displayName: tenantProfiles.displayName,
      publishedAt: tenantProfiles.publishedAt,
    })
    .from(tenants)
    .leftJoin(tenantProfiles, eq(tenantProfiles.tenantId, tenants.id))
    .where(and(inArray(tenants.id, [...new Set(tenantIds)]), eq(tenants.kind, 'AGENCY')));
  return new Map(
    rows.map((r) => [
      r.id,
      { id: r.id, name: (r.publishedAt !== null ? r.displayName : null) ?? r.name },
    ]),
  );
}
