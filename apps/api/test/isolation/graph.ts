import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';

/**
 * One row in every workspace-scoped table, belonging to two real workspaces (T-077).
 *
 * The isolation matrix needs something to fail to reach. Written as the owner, like every
 * fixture, and left in states nothing else may see: the investigator's profile is a DRAFT and
 * the mission is a DRAFT — complete enough to be moved to QUOTED, which the projection tests do —
 * so a row visible to a third workspace is a policy failure and never
 * the public projection doing its job. The projections are tested for what they do show, in
 * `isolation-matrix.spec.ts`.
 */
export interface SeededWorkspace {
  readonly userId: string;
  readonly tenantId: string;
  readonly membershipId: string;
}

export interface SeededGraph {
  /** The customer's workspace: missions, their history and screening, an idempotency key. */
  readonly customer: SeededWorkspace;
  /** The supplier's workspace: the profile and everything hanging off it. */
  readonly supplier: SeededWorkspace;
  /** One row per table, by table name: the value of that table's key column. */
  readonly rows: Readonly<Record<string, string>>;
}

const email = () => `iso-${randomUUID()}@example.test`;

async function workspace(owner: postgres.Sql): Promise<SeededWorkspace> {
  const [user] = await owner<{ id: string }[]>`
    INSERT INTO users (email, status) VALUES (${email()}, 'ACTIVE') RETURNING id`;
  const [row] = await owner<{ tenant: string; membership: string }[]>`
    SELECT t.id AS tenant, m.id AS membership
      FROM tenants t JOIN tenant_memberships m ON m.tenant_id = t.id
     WHERE t.personal_owner_id = ${user!.id}`;
  return { userId: user!.id, tenantId: row!.tenant, membershipId: row!.membership };
}

/**
 * A customer with one mission and nothing attached to it — for a test that needs a mission no
 * quote or assignment has claimed yet. `seedGraph` builds the whole chain; this is the start of it.
 */
export async function seedMission(
  owner: postgres.Sql,
  status: 'DRAFT' | 'QUOTED' = 'QUOTED',
): Promise<{ workspace: SeededWorkspace; missionId: string }> {
  const workspace_ = await workspace(owner);
  const [node] = await owner<{ id: string }[]>`
    INSERT INTO taxonomy_nodes (slug) VALUES (${`iso-${randomUUID()}`}) RETURNING id`;
  const [mission] = await owner<{ id: string }[]>`
    INSERT INTO missions (customer_id, title, description, status, version, taxonomy_node_id,
                          country_code, deadline, budget_min_minor, budget_max_minor, currency,
                          languages, purpose, subject_relationship, lawful_purpose_confirmed_at,
                          submitted_at)
    VALUES (${workspace_.userId}, 'Isolation', 'A mission for the matrix.', ${status}, 1,
            ${node!.id}, 'AM', now() + interval '30 days', 50000, 150000, 'AMD', ARRAY['en'],
            'A probe.', 'BUSINESS_RELATIONSHIP', now(), now())
    RETURNING id`;
  return { workspace: workspace_, missionId: mission!.id };
}

/** An investigator with a DRAFT profile and one open verification request, and nothing decided. */
export async function seedApplicant(
  owner: postgres.Sql,
): Promise<{ workspace: SeededWorkspace; profileId: string; requestId: string }> {
  const workspace_ = await workspace(owner);
  const [profile] = await owner<{ id: string }[]>`
    INSERT INTO investigator_profiles (user_id, visibility) VALUES (${workspace_.userId}, 'DRAFT')
    RETURNING id`;
  const [request] = await owner<{ id: string }[]>`
    INSERT INTO verification_requests (profile_id, declared_scope)
    VALUES (${profile!.id}, '{"specialtyNodeIds":[],"serviceAreas":[]}'::jsonb) RETURNING id`;
  return { workspace: workspace_, profileId: profile!.id, requestId: request!.id };
}

export async function seedGraph(owner: postgres.Sql): Promise<SeededGraph> {
  const customer = await workspace(owner);
  const supplier = await workspace(owner);
  const id = async (q: postgres.PendingQuery<{ id: string }[]>) => (await q)[0]!.id;

  const [node] = await owner<{ id: string }[]>`
    INSERT INTO taxonomy_nodes (slug) VALUES (${`iso-${randomUUID()}`}) RETURNING id`;

  const customerProfile = await id(owner`
    INSERT INTO customer_profiles (user_id) VALUES (${customer.userId}) RETURNING id`);
  const profile = await id(owner`
    INSERT INTO investigator_profiles (user_id, visibility) VALUES (${supplier.userId}, 'DRAFT')
    RETURNING id`);
  const language = await id(owner`
    INSERT INTO investigator_languages (profile_id, language_code, proficiency)
    VALUES (${profile}, 'en', 'FLUENT') RETURNING id`);
  const specialty = await id(owner`
    INSERT INTO investigator_specialties (profile_id, taxonomy_node_id)
    VALUES (${profile}, ${node!.id}) RETURNING id`);
  const availability = await id(owner`
    INSERT INTO investigator_availability (profile_id, day_of_week, start_minute, end_minute)
    VALUES (${profile}, 1, 540, 1020) RETURNING id`);
  const area = await id(owner`
    INSERT INTO service_areas (profile_id, kind, label, centre, radius_m, area)
    VALUES (${profile}, 'RADIUS', 'iso', ST_SetSRID(ST_MakePoint(44.5, 40.2), 4326)::geography, 5000,
            ST_Buffer(ST_SetSRID(ST_MakePoint(44.5, 40.2), 4326)::geography, 5000))
    RETURNING id`);
  const asset = await id(owner`
    INSERT INTO media_assets (owner_id, category, visibility, public_id, resource_type,
                              declared_mime_type, declared_bytes, authorization_expires_at)
    VALUES (${supplier.userId}, 'VERIFICATION_DOCUMENT', 'STAFF_REVIEW_ONLY', ${`iso/${randomUUID()}`},
            'image', 'image/png', 1024, now() + interval '5 minutes')
    RETURNING id`);
  const request = await id(owner`
    INSERT INTO verification_requests (profile_id, declared_scope)
    VALUES (${profile}, '{"specialtyNodeIds":[],"serviceAreas":[]}'::jsonb) RETURNING id`);
  const document = await id(owner`
    INSERT INTO verification_request_documents (request_id, media_asset_id)
    VALUES (${request}, ${asset}) RETURNING id`);
  const decision = await id(owner`
    INSERT INTO verification_decisions (request_id, outcome, reason, decided_by)
    VALUES (${request}, 'APPROVED', 'iso', ${customer.userId}) RETURNING id`);
  const key = await id(owner`
    INSERT INTO idempotency_keys (actor_id, endpoint, key, request_fingerprint)
    VALUES (${customer.userId}, 'iso', ${randomUUID()}, 'f') RETURNING id`);

  const mission = await id(owner`
    INSERT INTO missions (customer_id, title, description, status, version, taxonomy_node_id,
                          country_code, deadline, budget_min_minor, budget_max_minor, currency,
                          languages, purpose, subject_relationship, lawful_purpose_confirmed_at,
                          submitted_at)
    VALUES (${customer.userId}, 'Isolation', 'A mission for the matrix.', 'DRAFT', 1, ${node!.id},
            'AM', now() + interval '30 days', 50000, 150000, 'AMD', ARRAY['en'], 'A probe.',
            'BUSINESS_RELATIONSHIP', now(), now()) RETURNING id`);
  const history = await id(owner`
    INSERT INTO mission_status_history (mission_id, to_status, actor_kind, actor_id)
    VALUES (${mission}, 'DRAFT', 'CUSTOMER', ${customer.userId}) RETURNING id`);
  const screening = await id(owner`
    INSERT INTO mission_screenings (mission_id, mission_version, ruleset_version, outcome, risk_band, flags)
    VALUES (${mission}, 1, 'iso', 'ROUTINE_REVIEW', 'STANDARD', '[]'::jsonb) RETURNING id`);
  const quote = await id(owner`
    INSERT INTO quotes (mission_id, investigator_profile_id, price_minor, currency,
                        estimated_duration_days, scope, deliverables, cancellation_terms, expires_at)
    VALUES (${mission}, ${profile}, 1000, 'AMD', 3, 'Scope', 'Report', 'Refund', now() + interval '2 days')
    RETURNING id`);
  const assignment = await id(owner`
    INSERT INTO assignments (mission_id, quote_id, customer_id, investigator_profile_id, accepted_scope,
                             deliverables, cancellation_terms, price_minor, currency,
                             estimated_duration_days, payment_reference, payment_authorized_at,
                             acceptance_due_at)
    VALUES (${mission}, ${quote}, ${customer.userId}, ${profile}, 'Scope', 'Report', 'Refund', 1000,
            'AMD', 3, ${`pi_${randomUUID()}`}, now(), now() + interval '2 days') RETURNING id`);
  const assignmentHistory = await id(owner`
    INSERT INTO assignment_status_history (assignment_id, to_status, actor_kind)
    VALUES (${assignment}, 'PENDING_ACCEPTANCE', 'SYSTEM') RETURNING id`);

  // Shared, so it is readable by the customer's workspace too — the stronger case for the matrix:
  // a row both parties can see is still one no third workspace can (T-031).
  const source = await id(owner`
    INSERT INTO investigation_sources (assignment_id, type, title, shared, added_by)
    VALUES (${assignment}, 'REGISTRY', 'Company register extract', true, ${supplier.userId})
    RETURNING id`);

  // A halt under review, and the hold it put on the money (T-050).
  const review = await id(owner`
    INSERT INTO policy_reviews (assignment_id, mission_id, kind, ground, raised_by)
    VALUES (${assignment}, ${mission}, 'HALT', 'The attachment appears to be an intercepted message',
            ${supplier.userId})
    RETURNING id`);
  const money = await id(owner`
    INSERT INTO money_decisions (assignment_id, policy_review_id, decision, currency, reason, decided_by)
    VALUES (${assignment}, ${review}, 'HOLD', 'AMD', 'Held while the halt is reviewed', ${supplier.userId})
    RETURNING id`);

  // Knowledge that belongs to one workspace — an agency's own (T-097), the case the matrix can test:
  // the platform's rows, with no tenant, are meant to be readable everywhere (T-016).
  const knowledgeDoc = async (key: string) =>
    id(owner`
      INSERT INTO knowledge_documents (tenant_id, doc_key, locale, version, status, title, audience,
                                       visibility, source_of_truth, source_path, updated_on, content_hash)
      VALUES (${customer.tenantId}, ${key}, 'en', 1, 'current', 'Our intake process', 'agency',
              'authenticated', 'docs', ${`docs/knowledge-base/agency/${key}.en.md`}, current_date,
              ${randomUUID()})
      RETURNING id`);
  const [docA, docB] = [
    await knowledgeDoc(`iso-a-${randomUUID()}`),
    await knowledgeDoc(`iso-b-${randomUUID()}`),
  ].sort() as [string, string];
  const chunk = await id(owner`
    INSERT INTO knowledge_chunks (document_id, ordinal, heading, content, content_hash, visibility, locale)
    VALUES (${docA}, 0, 'How do we take on a case?', 'Intake is by referral.', ${randomUUID()}, 'authenticated', 'en')
    RETURNING id`);
  const conflict = await id(owner`
    INSERT INTO knowledge_conflicts (document_a, document_b, reason, subject)
    VALUES (${docA}, ${docB}, 'same_question', 'how do we take on a case?') RETURNING id`);

  // A conversation with the assistant, the customer's own (T-045).
  const conversation = await id(owner`
    INSERT INTO ai_sessions (tenant_id, user_id, title)
    VALUES (${customer.tenantId}, ${customer.userId}, 'Planning a due-diligence mission')
    RETURNING id`);
  const said = await id(owner`
    INSERT INTO ai_messages (session_id, sequence, role, content)
    VALUES (${conversation}, 1, 'USER', 'What does a due-diligence mission cover?') RETURNING id`);

  // An entry in the customer's workspace, so the matrix has one to fail to reach (T-080).
  const entry = await id(owner`
    INSERT INTO audit_logs (action, resource_type, resource_id, tenant_id)
    VALUES ('iso.probe', 'probe', ${randomUUID()}, ${customer.tenantId}) RETURNING id`);

  return {
    customer,
    supplier,
    rows: {
      audit_logs: entry,
      tenants: customer.tenantId,
      tenant_memberships: customer.membershipId,
      // membership_roles is keyed by its membership and role, not by an id (see KEY_COLUMN).
      membership_roles: customer.membershipId,
      customer_profiles: customerProfile,
      investigator_profiles: profile,
      investigator_languages: language,
      investigator_specialties: specialty,
      investigator_availability: availability,
      service_areas: area,
      media_assets: asset,
      verification_requests: request,
      verification_request_documents: document,
      verification_decisions: decision,
      idempotency_keys: key,
      missions: mission,
      mission_status_history: history,
      mission_screenings: screening,
      quotes: quote,
      assignments: assignment,
      assignment_status_history: assignmentHistory,
      investigation_sources: source,
      ai_sessions: conversation,
      ai_messages: said,
      policy_reviews: review,
      money_decisions: money,
      knowledge_documents: docA!,
      knowledge_chunks: chunk,
      knowledge_conflicts: conflict,
    },
  };
}
