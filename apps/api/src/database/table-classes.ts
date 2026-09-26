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
  /**
   * Platform data that staff maintain through the application rather than by migration
   * (T-053). The runtime role may INSERT and UPDATE it — never DELETE — and row-level security
   * admits those writes only inside PlatformContext. `rls.spec.ts` holds both halves.
   */
  readonly staffMaintained?: true;
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

  taxonomy_nodes: {
    class: 'platform',
    staffMaintained: true,
    note: 'read by everyone; written only by TAXONOMY staff inside PlatformContext, enforced by policy (T-053)',
  },
  taxonomy_node_labels: {
    class: 'platform',
    staffMaintained: true,
    note: 'as taxonomy_nodes: read by everyone, written only under platform access (T-053)',
  },
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
  tenant_invitations: {
    class: 'tenancy',
    columns: ['tenant_id'],
    note: 'its workspace reads and writes it; the invitee reads their own pending one and accepts it, keyed on their account’s confirmed email (T-085)',
  },

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
  tenant_profiles: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'public projection: any workspace reads it while published; agencies only, one per agency; the agency behind it (tenants) and its logo and cover (media_assets) are readable through it (T-084)',
  },
  tenant_settings: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'private to the workspace; one row per saved section, an absent section being its defaults (T-084)',
  },
  teams: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'private to the agency; a name unique per agency (T-086)',
  },
  team_members: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'tenant_id held equal to the team’s and the membership’s by composite keys; a removed member leaves every team by trigger (T-086)',
  },
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
  policy_reviews: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'asymmetric: the supplier workspace raises and reads; only staff under platform access decide; the customer does not read the ground (T-050)',
  },
  money_decisions: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'both parties read; the supplier records only FULL_REFUND or HOLD; staff record the rest and payments marks execution (T-050)',
  },
  reviews: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'public projection: any workspace reads a standing rating once the profile is PUBLISHED; the customer writes, staff remove (T-037)',
  },
  review_texts: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'public projection: others read a text only while PUBLISHED and its review is readable; pre-moderated by staff; the non-author party may report one back (T-037)',
  },
  knowledge_documents: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    nullable: {
      tenant_id:
        'NULL is the platform knowledge base, readable in every workspace; an agency’s own documents carry theirs (T-097)',
    },
    note: 'written only by the sync, under platform access; retrieval filters on visibility (T-016)',
  },
  knowledge_chunks: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    nullable: { tenant_id: 'as its document: NULL is the platform knowledge base (T-016)' },
    note: 'tenant and visibility copied from the document; only current documents have chunks',
  },
  knowledge_conflicts: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    nullable: { tenant_id: 'as its documents: NULL is the platform knowledge base (T-016)' },
  },
  ai_sessions: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'narrower than the class: its own user in its own workspace only, so not even an agency owner reads a colleague’s conversation (T-045)',
  },
  saved_mission_searches: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'narrower than the class, as ai_sessions: its own user in its own workspace only (T-054)',
  },
  ai_messages: {
    class: 'tenant_owned',
    columns: ['tenant_id'],
    note: 'as ai_sessions, with the owner copied from the session; append-only (T-045)',
  },
  investigation_sources: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'asymmetric: the supplier workspace reads and writes; the customer workspace reads shared, unwithdrawn rows only (T-031)',
  },
  investigation_notes: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'narrower than the class: only the author, in the supplier workspace, reads and writes — not even an agency owner reads a colleague’s note; the customer workspace reads shared, undeleted rows only (T-032)',
  },
  investigation_tasks: {
    class: 'two_party',
    columns: ['customer_tenant_id', 'supplier_tenant_id'],
    note: 'as investigation_notes, with the creator in place of the author (T-032)',
  },
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
