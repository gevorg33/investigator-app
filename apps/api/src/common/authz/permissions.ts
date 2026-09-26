/**
 * The tenant permission catalog, as names code may ask for (T-078).
 *
 * The catalog itself is **data**: 40 permissions, 6 system roles and 134 grants, seeded by
 * migration 0011 from the matrix in `docs/architecture/tenancy.md` §3, and read per request with
 * the membership. This list exists only so that a service asking for a permission that does not
 * exist fails to compile rather than failing closed at runtime on every request — and
 * `permissions.spec.ts` fails if it and the seeded catalog ever disagree.
 *
 * What a role grants is never written here, and never in a service. A check names a permission;
 * which roles hold it is the catalog's business alone.
 */
export const TENANT_PERMISSIONS = [
  'analytics.read',
  'audit.read',
  'billing.manage',
  'billing.read',
  'company.delete',
  'company.read',
  'company.update',
  'company.update_details',
  'employees.invite',
  'employees.read',
  'employees.remove',
  'employees.suspend',
  'employees.update',
  'evidence.read',
  'evidence.upload',
  'investigations.assign',
  'investigations.cancel',
  'investigations.create',
  'investigations.read',
  'investigations.read_all',
  'investigations.update',
  'investigators.assign',
  'investigators.create',
  'investigators.delete',
  'investigators.read',
  'investigators.update',
  'knowledge.create',
  'knowledge.delete',
  'knowledge.read',
  'knowledge.update',
  'leads.read',
  'leads.route',
  'reports.create',
  'reports.read',
  'reports.update',
  'settings.read',
  'settings.update',
  'teams.create',
  'teams.delete',
  'teams.read',
  'teams.update',
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];
