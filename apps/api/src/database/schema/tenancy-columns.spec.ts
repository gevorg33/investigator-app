import { randomUUID } from 'node:crypto';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { idempotencyKeys } from './idempotency';
import { missions } from './missions';
import { customerProfiles, investigatorProfiles } from './profiles';
import { tenants } from './tenants';

/**
 * How the tenant and party columns are filled and held (T-076), against the applied schema.
 * Every probe runs in a transaction that is rolled back.
 */
class RollbackSignal extends Error {}

describe('tenant and party columns', () => {
  let owner: postgres.Sql;

  beforeAll(() => {
    owner = testPool({ max: 2, role: 'owner' });
  });

  afterAll(async () => {
    await owner.end();
  });

  const probe = async <T>(body: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    let result: T | undefined;
    await owner
      .begin(async (tx) => {
        result = await body(tx);
        throw new RollbackSignal();
      })
      .catch((e: unknown) => {
        if (!(e instanceof RollbackSignal)) throw e;
      });
    return result as T;
  };

  /** A user and their Personal workspace. */
  const person = async (tx: postgres.TransactionSql) => {
    const [u] = await tx<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`tc-${randomUUID()}@example.test`}) RETURNING id`;
    const [w] = await tx<
      { id: string }[]
    >`SELECT id FROM tenants WHERE personal_owner_id = ${u!.id}`;
    return { userId: u!.id, personal: w!.id };
  };

  /** An agency owned by `userId`, for a workspace that is not anyone's Personal one. */
  const agency = async (tx: postgres.TransactionSql, userId: string) => {
    const [t] = await tx<{ id: string }[]>`
      INSERT INTO tenants (kind, status, name) VALUES ('AGENCY', 'ACTIVE', 'Probe') RETURNING id`;
    const [m] = await tx<{ id: string }[]>`
      INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id)
      VALUES (${t!.id}, 'AGENCY', ${userId}) RETURNING id`;
    await tx`
      INSERT INTO membership_roles (membership_id, role_id)
      SELECT ${m!.id}, id FROM roles WHERE key = 'OWNER' AND tenant_id IS NULL`;
    return t!.id;
  };

  const inContext = (tx: postgres.TransactionSql, tenantId: string) =>
    tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

  const profile = async (tx: postgres.TransactionSql, userId: string) => {
    const [p] = await tx<{ id: string; tenant_id: string }[]>`
      INSERT INTO investigator_profiles (user_id) VALUES (${userId}) RETURNING id, tenant_id`;
    return p!;
  };

  describe('owner columns', () => {
    it('take the owning user’s Personal workspace when there is no context', async () => {
      const seen = await probe(async (tx) => {
        const me = await person(tx);
        return { me, profile: await profile(tx, me.userId) };
      });
      expect(seen.profile.tenant_id).toBe(seen.me.personal);
    });

    it('take the execution context’s workspace when there is one', async () => {
      const seen = await probe(async (tx) => {
        const me = await person(tx);
        const ws = await agency(tx, me.userId);
        await inContext(tx, ws);
        const [m] = await tx<{ customer_tenant_id: string }[]>`
          INSERT INTO media_assets (owner_id, category, visibility, public_id, resource_type,
                                    declared_mime_type, declared_bytes, authorization_expires_at)
          VALUES (${me.userId}, 'PROFILE_IMAGE', 'PUBLIC_PROFILE', ${`p/${randomUUID()}`}, 'image',
                  'image/png', 10, now() + interval '5 minutes')
          RETURNING tenant_id AS customer_tenant_id`;
        return { ws, tenant: m!.customer_tenant_id };
      });
      expect(seen.tenant).toBe(seen.ws);
    });
  });

  describe('copied parties', () => {
    it('come from the parent, never from the context', async () => {
      // The request's context names another workspace; the service area still belongs to its
      // profile's. A child can never be steered into a workspace by whoever is writing it.
      const seen = await probe(async (tx) => {
        const me = await person(tx);
        const p = await profile(tx, me.userId);
        const elsewhere = await agency(tx, me.userId);
        await inContext(tx, elsewhere);
        const [a] = await tx<{ tenant_id: string }[]>`
          INSERT INTO investigator_languages (profile_id, language_code, proficiency)
          VALUES (${p.id}, 'en', 'FLUENT') RETURNING tenant_id`;
        return { profileTenant: p.tenant_id, childTenant: a!.tenant_id, elsewhere };
      });
      expect(seen.childTenant).toBe(seen.profileTenant);
      expect(seen.childTenant).not.toBe(seen.elsewhere);
    });

    it('give a quote its mission’s customer and its lead profile’s supplier, and an assignment its quote’s', async () => {
      const seen = await probe(async (tx) => {
        const customer = await person(tx);
        const investigator = await person(tx);
        const p = await profile(tx, investigator.userId);
        // A draft is enough: the quote's parties do not depend on the mission's status.
        const [mission] = await tx<{ id: string }[]>`
          INSERT INTO missions (customer_id, title, description, status, version)
          VALUES (${customer.userId}, 'Probe', 'A probe mission.', 'DRAFT', 1) RETURNING id`;
        const [quote] = await tx<
          { id: string; customer_tenant_id: string; supplier_tenant_id: string }[]
        >`
          INSERT INTO quotes (mission_id, investigator_profile_id, price_minor, currency,
                              estimated_duration_days, scope, deliverables, cancellation_terms, expires_at)
          VALUES (${mission!.id}, ${p.id}, 1000, 'AMD', 3, 'Scope', 'Report', 'Refund', now() + interval '2 days')
          RETURNING id, customer_tenant_id, supplier_tenant_id`;
        // Created by the system when a payment is authorized — no context at all — and still
        // given exactly the quote's two parties.
        const [assignment] = await tx<{ customer_tenant_id: string; supplier_tenant_id: string }[]>`
          INSERT INTO assignments (mission_id, quote_id, customer_id, investigator_profile_id,
                                   accepted_scope, deliverables, cancellation_terms, price_minor, currency,
                                   estimated_duration_days, payment_reference, payment_authorized_at,
                                   acceptance_due_at)
          VALUES (${mission!.id}, ${quote!.id}, ${customer.userId}, ${p.id}, 'Scope', 'Report', 'Refund',
                  1000, 'AMD', 3, 'pi_probe', now(), now() + interval '2 days')
          RETURNING customer_tenant_id, supplier_tenant_id`;
        return { customer, investigator, quote: quote!, assignment: assignment! };
      });
      expect(seen.quote.customer_tenant_id).toBe(seen.customer.personal);
      expect(seen.quote.supplier_tenant_id).toBe(seen.investigator.personal);
      expect(seen.assignment).toEqual({
        customer_tenant_id: seen.customer.personal,
        supplier_tenant_id: seen.investigator.personal,
      });
    });

    it('are held equal to the parent by the composite key even with the fill trigger gone', async () => {
      await expect(
        probe(async (tx) => {
          await tx`ALTER TABLE investigator_languages DISABLE TRIGGER investigator_languages_fill_from_profile`;
          const me = await person(tx);
          const p = await profile(tx, me.userId);
          const other = await person(tx);
          await tx`
            INSERT INTO investigator_languages (profile_id, language_code, proficiency, tenant_id)
            VALUES (${p.id}, 'en', 'FLUENT', ${other.personal})`;
        }),
      ).rejects.toThrow(/investigator_languages_profile_tenant_fk/);
    });
  });

  describe('no row moves to another workspace', () => {
    it.each([
      ['a profile', 'investigator_profiles', 'tenant_id'],
      ['a mission’s customer', 'missions', 'customer_tenant_id'],
    ])('refuses to move %s', async (_label, table, column) => {
      await expect(
        probe(async (tx) => {
          const me = await person(tx);
          const other = await person(tx);
          if (table === 'investigator_profiles') await profile(tx, me.userId);
          else {
            await tx`INSERT INTO missions (customer_id, title, description, status, version)
                     VALUES (${me.userId}, 'Probe', 'A probe mission.', 'DRAFT', 1)`;
          }
          const owner = table === 'investigator_profiles' ? 'user_id' : 'customer_id';
          await tx.unsafe(`UPDATE ${table} SET ${column} = $1 WHERE ${owner} = $2`, [
            other.personal,
            me.userId,
          ]);
        }),
      ).rejects.toThrow(/tenant_columns_immutable/);
    });
  });

  describe('idempotency keys', () => {
    const key = (tx: postgres.TransactionSql, actorId: string, k: string) =>
      tx<{ tenant_id: string | null }[]>`
        INSERT INTO idempotency_keys (actor_id, endpoint, key, request_fingerprint)
        VALUES (${actorId}, 'probe', ${k}, 'f') RETURNING tenant_id`;

    it('belong to the actor’s workspace, and to none for a system actor', async () => {
      const seen = await probe(async (tx) => {
        const me = await person(tx);
        const [mine] = await key(tx, me.userId, 'k1');
        const [system] = await key(tx, '00000000-0000-4000-8000-000000000000', 'k1');
        return { personal: me.personal, mine: mine!.tenant_id, system: system!.tenant_id };
      });
      expect(seen.mine).toBe(seen.personal);
      expect(seen.system).toBeNull();
    });

    it('let the same person use one key in two workspaces', async () => {
      await expect(
        probe(async (tx) => {
          const me = await person(tx);
          await key(tx, me.userId, 'shared');
          await inContext(tx, await agency(tx, me.userId));
          await key(tx, me.userId, 'shared');
        }),
      ).resolves.toBeUndefined();
    });

    it('still refuse the same system key twice — no workspace is not a free pass', async () => {
      await expect(
        probe(async (tx) => {
          await key(tx, '00000000-0000-4000-8000-000000000000', 'once');
          await key(tx, '00000000-0000-4000-8000-000000000000', 'once');
        }),
      ).rejects.toThrow(/idempotency_keys_scope_unique/);
    });
  });
});

describe('owner-column references', () => {
  const tenantRef = (table: PgTable) =>
    getTableConfig(table)
      .foreignKeys.map((f) => ({
        columns: f.reference().columns.map((c) => c.name),
        target: f.reference().foreignTable,
        onDelete: f.onDelete,
      }))
      .filter((r) => r.target === tenants);

  it.each([
    ['idempotency_keys', idempotencyKeys, 'tenant_id'],
    ['customer_profiles', customerProfiles, 'tenant_id'],
    ['investigator_profiles', investigatorProfiles, 'tenant_id'],
    ['missions', missions, 'customer_tenant_id'],
  ] as Array<[string, PgTable, string]>)(
    '%s points its owner column at the workspace, and cannot outlive it',
    (_name, table, column) => {
      expect(tenantRef(table)).toEqual([{ columns: [column], target: tenants, onDelete: 'restrict' }]);
    },
  );
});
