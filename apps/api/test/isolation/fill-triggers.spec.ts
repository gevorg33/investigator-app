import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInContext, type ExecutionContext } from '../../src/common/context/execution-context';
import { drizzle } from 'drizzle-orm/postgres-js';
import { AuditService } from '../../src/common/audit/audit.service';
import { PlatformContext } from '../../src/common/context/platform-context';
import * as schema from '../../src/database/schema';
import { scopedClient } from '../../src/database/scoped-client';
import { testPool } from '../db';
import { personalContext } from '../workspace-context';
import { member } from '../workspace-fixtures';
import { seedApplicant, seedGraph, seedMission, type SeededGraph } from './graph';

/**
 * The fill triggers, run as `investigator_app` with the policies on (T-077).
 *
 * `fill_party_from_parent` copies a row's workspace from its parent, and it runs with the
 * writer's privileges — so the parent has to be visible to the writer, or the copy is NULL and
 * the insert fails its NOT NULL. Every copy path therefore depends on a policy, and each is
 * exercised here through the path the application takes: a supplier quoting a QUOTED mission,
 * the system creating an assignment from that quote, an investigator adding to their own
 * profile, a reviewer recording a decision.
 *
 * Failing closed is the point. Where the parent is not visible the insert is refused — never
 * filled from the writer's own workspace instead.
 */
describe('filling a row’s workspace under row-level security', () => {
  let app: postgres.Sql;
  let scoped: postgres.Sql;
  let owner: postgres.Sql;
  let platform: PlatformContext;
  let graph: SeededGraph;
  let supplier: ExecutionContext;
  let customer: ExecutionContext;
  let outsider: ExecutionContext;

  beforeAll(async () => {
    app = testPool({ max: 2 });
    scoped = scopedClient(app);
    owner = testPool({ max: 2, role: 'owner' });
    platform = new PlatformContext(new AuditService(drizzle(scoped, { schema })));
    graph = await seedGraph(owner);
    supplier = await personalContext(owner, graph.supplier.userId);
    customer = await personalContext(owner, graph.customer.userId);
    outsider = await personalContext(owner, (await member(owner)).actor.userId);
    await owner`UPDATE missions SET status = 'QUOTED' WHERE id = ${graph.rows['missions']!}`;
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  const write = <T>(context: ExecutionContext, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    runInContext(context, () => scoped.begin(fn));

  const workspaceOf = async (table: string, id: string, column = 'tenant_id') => {
    const [row] = await owner<{ value: string | null }[]>`
      SELECT ${owner(column)} AS value FROM ${owner(table)} WHERE id = ${id}`;
    return row?.value ?? null;
  };

  /**
   * Another customer's mission, open for quoting. A fresh one each time: our supplier already
   * quoted the seeded mission, and only one live quote per investigator per mission is allowed.
   */
  const openMission = () => seedMission(owner);

  const quoteOn = (mission: string, price = 2000) =>
    write(
      supplier,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO quotes (mission_id, investigator_profile_id, price_minor, currency,
                            estimated_duration_days, scope, deliverables, cancellation_terms,
                            expires_at)
        VALUES (${mission}, ${graph.rows['investigator_profiles']!}, ${price}, 'AMD', 4,
                'Scope', 'Report', 'Refund', now() + interval '2 days')
        RETURNING id`,
    );

  it('gives a quote the mission’s customer and the quoting profile’s supplier', async () => {
    const theirs = await openMission();
    const [quote] = await quoteOn(theirs.missionId);

    expect(await workspaceOf('quotes', quote!.id, 'customer_tenant_id')).toBe(
      theirs.workspace.tenantId,
    );
    expect(await workspaceOf('quotes', quote!.id, 'supplier_tenant_id')).toBe(
      graph.supplier.tenantId,
    );
  });

  it('refuses a quote on a mission the supplier cannot see, rather than filling in their own', async () => {
    // Left as a DRAFT, so no projection shows it: the trigger reads nothing and the NOT NULL
    // stops the row. The supplier's own workspace is never substituted for the one it cannot see.
    const hidden = await seedMission(owner, 'DRAFT');
    await expect(quoteOn(hidden.missionId)).rejects.toThrow(
      /null value in column "customer_tenant_id"|row-level security/,
    );
  });

  it('gives an assignment the quote’s two parties, written by the system with no workspace', async () => {
    const theirs = await openMission();
    const [quote] = await quoteOn(theirs.missionId, 3000);

    const [assignment] = await platform.asSystem('assignment.create_from_payment', {}, () =>
      scoped.begin(
        (tx) => tx<{ id: string }[]>`
          INSERT INTO assignments (mission_id, quote_id, customer_id, investigator_profile_id,
                                   accepted_scope, deliverables, cancellation_terms, price_minor,
                                   currency, estimated_duration_days, payment_reference,
                                   payment_authorized_at, acceptance_due_at)
          SELECT q.mission_id, q.id, ${theirs.workspace.userId}, q.investigator_profile_id, q.scope,
                 q.deliverables, q.cancellation_terms, q.price_minor, q.currency,
                 q.estimated_duration_days, ${`pi_${randomUUID()}`}, now(),
                 now() + interval '2 days'
            FROM quotes q WHERE q.id = ${quote!.id}
          RETURNING id`,
      ),
    );

    expect(await workspaceOf('assignments', assignment!.id, 'customer_tenant_id')).toBe(
      theirs.workspace.tenantId,
    );
    expect(await workspaceOf('assignments', assignment!.id, 'supplier_tenant_id')).toBe(
      graph.supplier.tenantId,
    );
  });

  it('copies a child’s workspace from the profile it belongs to', async () => {
    const [area] = await write(
      supplier,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO service_areas (profile_id, kind, label, centre, radius_m, area)
        VALUES (${graph.rows['investigator_profiles']!}, 'RADIUS', 'filled',
                ST_SetSRID(ST_MakePoint(44.6, 40.1), 4326)::geography, 5000,
                ST_Buffer(ST_SetSRID(ST_MakePoint(44.6, 40.1), 4326)::geography, 5000))
        RETURNING id`,
    );
    expect(await workspaceOf('service_areas', area!.id)).toBe(graph.supplier.tenantId);
  });

  it('refuses a child written onto a published profile from another workspace', async () => {
    // Here the parent *is* visible, through the public projection, so the trigger can read it —
    // and WITH CHECK is what stops the row, because what it copied is not the writer's workspace.
    await owner`
      UPDATE investigator_profiles SET visibility = 'PUBLISHED'
       WHERE id = ${graph.rows['investigator_profiles']!}`;
    try {
      await expect(
        write(
          outsider,
          (tx) => tx`
            INSERT INTO service_areas (profile_id, kind, label, centre, radius_m, area)
            VALUES (${graph.rows['investigator_profiles']!}, 'RADIUS', 'taken',
                    ST_SetSRID(ST_MakePoint(44.7, 40.3), 4326)::geography, 5000,
                    ST_Buffer(ST_SetSRID(ST_MakePoint(44.7, 40.3), 4326)::geography, 5000))`,
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await owner`
        UPDATE investigator_profiles SET visibility = 'DRAFT'
         WHERE id = ${graph.rows['investigator_profiles']!}`;
    }
  });

  it('copies a verification decision’s workspace from the request, written by a reviewer', async () => {
    const applicant = await seedApplicant(owner); // its own request: one decision per request
    const staff = {
      userId: outsider.userId,
      roles: ['STAFF'] as const,
      staffScopes: ['VERIFICATION'] as const,
      activeRole: undefined,
    };
    const [decision] = await runInContext(outsider, () =>
      platform.asStaff(staff as never, { scope: 'VERIFICATION', purpose: 'verification.decide' }, {}, () =>
        scoped.begin(
          (tx) => tx<{ id: string }[]>`
            INSERT INTO verification_decisions (request_id, outcome, reason, decided_by)
            VALUES (${applicant.requestId}, 'REJECTED', 'filled',
                    ${outsider.userId})
            RETURNING id`,
        ),
      ),
    );
    expect(await workspaceOf('verification_decisions', decision!.id)).toBe(
      applicant.workspace.tenantId,
    );
  });

  it('gives a mission’s history the customer’s workspace, written by the customer', async () => {
    const [entry] = await write(
      customer,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO mission_status_history (mission_id, from_status, to_status, actor_kind, actor_id)
        VALUES (${graph.rows['missions']!}, 'QUOTED', 'CANCELLED', 'CUSTOMER',
                ${graph.customer.userId})
        RETURNING id`,
    );
    expect(await workspaceOf('mission_status_history', entry!.id, 'customer_tenant_id')).toBe(
      graph.customer.tenantId,
    );
  });

  it('gives an owner column the workspace the request is acting in', async () => {
    const [asset] = await write(
      supplier,
      (tx) => tx<{ id: string }[]>`
        INSERT INTO media_assets (owner_id, category, visibility, public_id, resource_type,
                                  declared_mime_type, declared_bytes, authorization_expires_at)
        VALUES (${graph.supplier.userId}, 'PROFILE_IMAGE', 'PUBLIC_PROFILE',
                ${`fill/${randomUUID()}`}, 'image', 'image/png', 10, now() + interval '5 minutes')
        RETURNING id`,
    );
    expect(await workspaceOf('media_assets', asset!.id)).toBe(graph.supplier.tenantId);
  });
});
