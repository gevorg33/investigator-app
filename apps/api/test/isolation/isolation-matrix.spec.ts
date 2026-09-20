import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  runAsUser,
  runInContext,
  type ExecutionContext,
} from '../../src/common/context/execution-context';
import { PlatformContext } from '../../src/common/context/platform-context';
import { scopedClient } from '../../src/database/scoped-client';
import { TABLE_CLASSES } from '../../src/database/table-classes';
import { testPool } from '../db';
import { personalContext } from '../workspace-context';
import { member } from '../workspace-fixtures';
import { seedGraph, type SeededGraph } from './graph';

/**
 * The isolation matrix (T-077): every workspace-scoped table, every operation, run as
 * `investigator_app` with row-level security on.
 *
 * Generated from `TABLE_CLASSES`, so a new table is in this matrix the day it is classified —
 * there is no list here to forget to extend. The rows it reaches for are seeded in states no
 * projection publishes (a DRAFT profile, a DRAFT mission), so a row that shows up in another
 * workspace is a policy failure and never discovery working as intended. What the projections
 * *do* show is asserted separately, below.
 *
 * Every refusal is recorded with its reason, so a cell that passes for the wrong reason — a
 * missing privilege standing in for a missing policy — is visible rather than green.
 */
type Outcome = 'no rows' | 'refused' | 'REACHED';

/** Every scoped table is keyed by `id`, except the one that is keyed by what it joins. */
const KEY_COLUMN: Readonly<Record<string, string>> = { membership_roles: 'membership_id' };
const keyOf = (table: string): string => KEY_COLUMN[table] ?? 'id';

/**
 * A customer's card is readable from any workspace, which is what the application already did
 * before the policies existed and what the owner decided to keep (2026-09-20): the service
 * projects the few fields a supplier may see. Narrowing it to the parties who share a mission is
 * T-098's to weigh. It is therefore tested for what it shows, not for hiding.
 */
const PUBLIC_TO_EVERY_WORKSPACE = ['customer_profiles'];

const SCOPED = Object.entries(TABLE_CLASSES)
  .filter(([, s]) => s.class === 'tenancy' || s.class === 'tenant_owned' || s.class === 'two_party')
  .map(([table]) => table)
  .sort();

describe('the isolation matrix', () => {
  let app: postgres.Sql;
  let scoped: postgres.Sql;
  let owner: postgres.Sql;
  let graph: SeededGraph;
  /** A workspace with no part in any of it. */
  let outsider: ExecutionContext;
  let privileges: Map<string, Set<string>>;

  beforeAll(async () => {
    app = testPool({ max: 2 });
    scoped = scopedClient(app);
    owner = testPool({ max: 2, role: 'owner' });
    graph = await seedGraph(owner);
    outsider = await personalContext(owner, (await member(owner)).actor.userId);
    privileges = new Map();
    for (const grant of await owner<{ table: string; privilege: string }[]>`
      SELECT table_name AS table, privilege_type AS privilege
        FROM information_schema.role_table_grants
       WHERE grantee = 'investigator_app' AND table_schema = 'public'`) {
      const held = privileges.get(grant.table) ?? new Set<string>();
      held.add(grant.privilege);
      privileges.set(grant.table, held);
    }
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  /** Runs `fn` as `investigator_app`, in `context` or in none at all. */
  const as = <T>(
    context: ExecutionContext | undefined,
    fn: (tx: postgres.TransactionSql) => Promise<T>,
  ): Promise<T> =>
    context === undefined ? app.begin(fn) : runInContext(context, () => scoped.begin(fn));

  const rowsSeen = async (
    context: ExecutionContext | undefined,
    table: string,
  ): Promise<number> => {
    const [row] = await as(context, (tx) =>
      tx.unsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${keyOf(table)} = $1`,
        [graph.rows[table]!],
      ),
    );
    return row!.n;
  };

  const attempt = async (
    context: ExecutionContext | undefined,
    statement: string,
    params: unknown[],
  ): Promise<Outcome> => {
    try {
      const result = await as(context, (tx) => tx.unsafe(statement, params as never[]));
      return (result as unknown as { count: number }).count === 0 ? 'no rows' : 'REACHED';
    } catch {
      return 'refused';
    }
  };

  describe('another workspace', () => {
    it.each(SCOPED.filter((t) => !PUBLIC_TO_EVERY_WORKSPACE.includes(t)))(
      'cannot read %s',
      async (table) => {
        expect(await rowsSeen(outsider, table)).toBe(0);
      },
    );

    it.each(SCOPED.filter((t) => t !== 'tenants'))('cannot change %s', async (table) => {
      // `SET id = id` changes nothing: what is being tested is whether the row can be reached
      // at all. A workspace column cannot be used — those are immutable by trigger (T-076).
      const outcome =
        privileges.get(table)?.has('UPDATE') === true
          ? await attempt(
              outsider,
              `UPDATE ${table} SET ${keyOf(table)} = ${keyOf(table)} WHERE ${keyOf(table)} = $1`,
              [graph.rows[table]!],
            )
          : 'refused';
      expect(outcome).not.toBe('REACHED');
    });

    it.each(SCOPED)('cannot delete from %s', async (table) => {
      const outcome =
        privileges.get(table)?.has('DELETE') === true
          ? await attempt(outsider, `DELETE FROM ${table} WHERE ${keyOf(table)} = $1`, [
              graph.rows[table]!,
            ])
          : 'refused';
      expect(outcome).not.toBe('REACHED');
    });

    it.each(SCOPED)('cannot write a row into %s belonging to another workspace', async (table) => {
      const id = randomUUID();
      const [original] = await owner<{ row: Record<string, unknown> }[]>`
        SELECT to_jsonb(t) AS row FROM ${owner(table)} t
         WHERE ${owner(keyOf(table))} = ${graph.rows[table]!}`;
      const copy = { ...original!.row, [keyOf(table)]: id };
      // Unique columns that would collide with the original, so the refusal that matters is the
      // policy's and not an index's.
      for (const column of ['key', 'public_id', 'payment_reference', 'quote_id', 'mission_id']) {
        if (typeof copy[column] === 'string') copy[column] = randomUUID();
      }
      await attempt(
        outsider,
        `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`,
        [JSON.stringify(copy)],
      );
      const landed = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${owner(table)} WHERE ${owner(keyOf(table))} = ${id}`;
      expect(landed[0]!.n).toBe(0);
    });
  });

  describe('no context at all', () => {
    it.each(SCOPED)('reads nothing from %s', async (table) => {
      expect(await rowsSeen(undefined, table)).toBe(0);
    });

    it.each(SCOPED)('writes nothing into %s', async (table) => {
      const id = randomUUID();
      const [original] = await owner<{ row: Record<string, unknown> }[]>`
        SELECT to_jsonb(t) AS row FROM ${owner(table)} t
         WHERE ${owner(keyOf(table))} = ${graph.rows[table]!}`;
      const copy = { ...original!.row, [keyOf(table)]: id };
      for (const column of ['key', 'public_id', 'payment_reference', 'quote_id', 'mission_id']) {
        if (typeof copy[column] === 'string') copy[column] = randomUUID();
      }
      expect(
        await attempt(
          undefined,
          `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`,
          [JSON.stringify(copy)],
        ),
      ).toBe('refused');
      const landed = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM ${owner(table)} WHERE ${owner(keyOf(table))} = ${id}`;
      expect(landed[0]!.n).toBe(0);
    });
  });

  describe('what a policy is allowed to reach', () => {
    it('has no policy that reaches a table whose policy reaches back', async () => {
      // Recursion is not a review question: PostgreSQL raises 42P17 at query time. Every scoped
      // table is read, written and joined to its neighbours in one context, so a cycle shows up
      // here rather than in production.
      const failures: string[] = [];
      for (const table of SCOPED) {
        try {
          await as(outsider, (tx) =>
            tx.unsafe(`SELECT count(*) FROM ${table} WHERE ${keyOf(table)} = $1`, [
              graph.rows[table]!,
            ]),
          );
        } catch (e) {
          failures.push(`${table}: ${(e as Error).message}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('covers every workspace-scoped table in the registry', () => {
      // The matrix is generated: this is what stops a class from quietly leaving it.
      expect(SCOPED.length).toBeGreaterThanOrEqual(20);
      expect(SCOPED.every((t) => graph.rows[t] !== undefined)).toBe(true);
    });
  });

  describe('what the projections do show', () => {
    it('shows a PUBLISHED profile and its areas to any workspace, and a DRAFT to none', async () => {
      const profile = graph.rows['investigator_profiles']!;
      expect(await rowsSeen(outsider, 'investigator_profiles')).toBe(0);
      await owner`UPDATE investigator_profiles SET visibility = 'PUBLISHED' WHERE id = ${profile}`;
      try {
        expect(await rowsSeen(outsider, 'investigator_profiles')).toBe(1);
        expect(await rowsSeen(outsider, 'service_areas')).toBe(1);
        expect(await rowsSeen(outsider, 'investigator_languages')).toBe(1);
      } finally {
        await owner`UPDATE investigator_profiles SET visibility = 'DRAFT' WHERE id = ${profile}`;
      }
      expect(await rowsSeen(outsider, 'service_areas')).toBe(0);
    });

    it('shows a mission while it is QUOTED, and never its history or screening', async () => {
      const mission = graph.rows['missions']!;
      expect(await rowsSeen(outsider, 'missions')).toBe(0);
      await owner`UPDATE missions SET status = 'QUOTED' WHERE id = ${mission}`;
      try {
        expect(await rowsSeen(outsider, 'missions')).toBe(1);
        expect(await rowsSeen(outsider, 'mission_status_history')).toBe(0);
        expect(await rowsSeen(outsider, 'mission_screenings')).toBe(0);
      } finally {
        await owner`UPDATE missions SET status = 'DRAFT' WHERE id = ${mission}`;
      }
    });

    it('shows a supplier the mission they quoted on, once the quote exists', async () => {
      const supplier = await personalContext(owner, graph.supplier.userId);
      expect(await rowsSeen(supplier, 'missions')).toBe(1);
      expect(await rowsSeen(supplier, 'quotes')).toBe(1);
      // The customer's side of the same mission stays the customer's.
      expect(await rowsSeen(supplier, 'mission_status_history')).toBe(0);
      expect(await rowsSeen(supplier, 'customer_profiles')).toBe(1); // the public card
      expect(await rowsSeen(supplier, 'idempotency_keys')).toBe(0);
    });

    it('shows each party its own side of a two-party row, and no third workspace either', async () => {
      const customer = await personalContext(owner, graph.customer.userId);
      const supplier = await personalContext(owner, graph.supplier.userId);
      for (const table of ['quotes', 'assignments', 'assignment_status_history']) {
        expect(await rowsSeen(customer, table)).toBe(1);
        expect(await rowsSeen(supplier, table)).toBe(1);
        expect(await rowsSeen(outsider, table)).toBe(0);
      }
    });
  });

  describe('the ways across', () => {
    it('lets platform access read another workspace, and nothing else does', async () => {
      const staff = {
        userId: outsider.userId,
        roles: ['STAFF'] as const,
        staffScopes: ['VERIFICATION'] as const,
        activeRole: undefined,
      };
      expect(await rowsSeen(outsider, 'verification_requests')).toBe(0);
      const seen = await runInContext(outsider, () =>
        PlatformContext.asStaff(staff as never, 'VERIFICATION', 'verification.review', async () => {
          // Through `begin`, like every query the application makes: a bare tagged template on
          // the pool is the unscoped path, and carries no context at all.
          const rows = await scoped.begin(
            (tx) =>
              tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM verification_requests
                 WHERE id = ${graph.rows['verification_requests']!}`,
          );
          return (rows[0] as unknown as { n: number }).n;
        }),
      );
      expect(seen).toBe(1);
    });

    it('shows a user their own memberships before any workspace is chosen, and no one else’s', async () => {
      const mine = await runAsUser(graph.customer.userId, async () => {
        const rows = await scoped.begin(
          (tx) =>
            tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM tenant_memberships WHERE user_id = ${graph.customer.userId}`,
        );
        return (rows[0] as unknown as { n: number }).n;
      });
      expect(mine).toBe(1);

      const theirs = await runAsUser(graph.customer.userId, async () => {
        const rows = await scoped.begin(
          (tx) =>
            tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM tenant_memberships WHERE user_id = ${graph.supplier.userId}`,
        );
        return (rows[0] as unknown as { n: number }).n;
      });
      expect(theirs).toBe(0);
    });

    it('lets a user create their own Personal workspace by registering, and nothing more', async () => {
      // Registration runs as investigator_app with no context at all: the trigger's three inserts
      // are exactly what the tenancy policies allow through.
      const [user] = await app<{ id: string }[]>`
        INSERT INTO users (email) VALUES (${`iso-reg-${randomUUID()}@example.test`}) RETURNING id`;
      const [row] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM tenants t
          JOIN tenant_memberships m ON m.tenant_id = t.id
          JOIN membership_roles mr ON mr.membership_id = m.id
         WHERE t.personal_owner_id = ${user!.id}`;
      expect(row!.n).toBe(1);

      // The same role cannot make a workspace for someone else, with or without a context.
      await expect(
        app`INSERT INTO tenants (kind, status, personal_owner_id) VALUES ('PERSONAL', 'ACTIVE', ${graph.supplier.userId})`,
      ).rejects.toThrow(/row-level security/);
      await expect(
        runInContext(
          outsider,
          () =>
            scoped`INSERT INTO tenants (kind, status, name) VALUES ('AGENCY', 'ACTIVE', 'Not mine')`,
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });
});
