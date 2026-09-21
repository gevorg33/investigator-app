/**
 * Every table, classified for workspace isolation (T-076, docs/architecture/tenancy.md §7).
 *
 * The registry row-level security (T-077) is generated from, and the reason a new table cannot
 * ship unprotected by omission: `table-classes.spec.ts` fails when a table in the database is
 * missing from here, when an entry names a table that no longer exists, or when a table's columns
 * do not match its class.
 */
export type TableClass =
  /** Who someone is. Read before any workspace exists (sign-in), so not workspace-scoped. */
  | 'identity'
  /** Platform data every workspace reads and none writes: taxonomy, the permission catalog. */
  | 'platform'
  /** The workspace model itself: workspaces, memberships and role assignments. */
  | 'tenancy'
  /** Belongs to exactly one workspace, named by `tenant_id`. */
  | 'tenant_owned'
  /** A marketplace row with two parties: `customer_tenant_id`, and `supplier_tenant_id` once there is one. */
  | 'two_party'
  /** Written in some workspace's context, read by system processes; workspace recorded where known. */
  | 'system'
  /** The audit trail: workspace recorded where there is one, visible by workspace or to platform staff. */
  | 'platform_record'
  /** Owned by PostGIS; never touched by the application. */
  | 'postgis';

export interface TableClassification {
  readonly class: TableClass;
  /** The tenant or party columns this table carries (tenant_owned and two_party). */
  readonly columns?: readonly string[];
  /** Columns allowed to be NULL, and why — each one a deliberate exception. */
  readonly nullable?: Readonly<Record<string, string>>;
  /** Anything a reader of the registry must know that the class does not say. */
  readonly note?: string;
}

export const TABLE_CLASSES: Readonly<Record<string, TableClassification>> = {
  users: { class: 'identity' },
  user_roles: { class: 'identity' },
  user_sessions: {
    class: 'identity',
    note: 'default_tenant_id is a preference, never an authority (T-075)',
  },
  user_identities: { class: 'identity' },
  user_tokens: { class: 'identity' },
  user_staff_scopes: { class: 'identity' },
  user_consents: {
    class: 'identity',
    note: 'belongs to a person, not a workspace, and outlives the account (T-021). Its tenant_id records where the consent was given, and is not what scopes the row',
  },

  taxonomy_nodes: { class: 'platform' },
  legal_documents: {
    class: 'platform',
    note: 'published text, the same for everyone; the application reads and never writes (T-021)',
  },
  permissions: { class: 'platform' },
  roles: {
    class: 'platform',
    note: 'system roles have no tenant; custom roles (later) will carry one',
  },
  role_permissions: { class: 'platform' },

  tenants: { class: 'tenancy' },
  tenant_memberships: { class: 'tenancy', columns: ['tenant_id'] },
  membership_roles: { class: 'tenancy', note: 'scoped through its membership' },

  customer_profiles: { class: 'tenant_owned', columns: ['tenant_id'] },
  investigator_profiles: { class: 'tenant_owned', columns: ['tenant_id'] },
  investigator_languages: { class: 'tenant_owned', columns: ['tenant_id'] },
  investigator_specialties: { class: 'tenant_owned', columns: ['tenant_id'] },
  investigator_availability: { class: 'tenant_owned', columns: ['tenant_id'] },
  service_areas: { class: 'tenant_owned', columns: ['tenant_id'] },
  media_assets: { class: 'tenant_owned', columns: ['tenant_id'] },
  verification_requests: { class: 'tenant_owned', columns: ['tenant_id'] },
  verification_request_documents: { class: 'tenant_owned', columns: ['tenant_id'] },
  verification_decisions: { class: 'tenant_owned', columns: ['tenant_id'] },
  idempotency_keys: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    nullable: {
      tenant_id:
        'NULL for a system action: assignment creation from a payment runs as a system actor with ' +
        'no workspace, and its key belongs to none rather than to an invented one',
    },
  },

  missions: {
    class: 'two_party',
    columns: ['customer_tenant_id'],
    note: 'no supplier column: suppliers reach a mission while it is QUOTED, or through their quote',
  },
  mission_status_history: { class: 'two_party', columns: ['customer_tenant_id'] },
  mission_screenings: { class: 'two_party', columns: ['customer_tenant_id'] },
  quotes: { class: 'two_party', columns: ['customer_tenant_id', 'supplier_tenant_id'] },
  assignments: { class: 'two_party', columns: ['customer_tenant_id', 'supplier_tenant_id'] },
  assignment_status_history: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
  },

  outbox_events: {
    class: 'system',
    note: 'its tenant column arrives with T-082 (jobs restore context)',
  },
  audit_logs: {
    class: 'platform_record',
    note: 'tenant_id, membership_id and session_id are filled by DEFAULT from the context (T-080); nullable, because plenty of audited things happen outside a workspace',
  },

  spatial_ref_sys: { class: 'postgis' },
};
