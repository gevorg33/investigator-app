import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  runAsUser,
  runInContext,
  type ExecutionContext,
} from '../../src/common/context/execution-context';
import { drizzle } from 'drizzle-orm/postgres-js';
import { AuditService } from '../../src/common/audit/audit.service';
import { PlatformContext } from '../../src/common/context/platform-context';
import * as schema from '../../src/database/schema';
import { scopedClient } from '../../src/database/scoped-client';
import { TABLE_CLASSES } from '../../src/database/table-classes';
import { testPool } from '../db';
import { agencyContext, personalContext } from '../workspace-context';
import { agency, member } from '../workspace-fixtures';
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

/** Every scoped table is keyed by `id`, except those keyed by what they join or belong to. */
const KEY_COLUMN: Readonly<Record<string, string>> = {
  membership_roles: 'membership_id',
  // One per agency, and one row per agency in the graph (T-084).
  tenant_profiles: 'tenant_id',
  tenant_settings: 'tenant_id',
  // A membership row has no id of its own; the graph puts one team member in (T-086).
  team_members: 'team_id',
};
const keyOf = (table: string): string => KEY_COLUMN[table] ?? 'id';

/**
 * A customer's card is readable from any workspace, which is what the application already did
 * before the policies existed and what the owner decided to keep (2026-09-20): the service
 * projects the few fields a supplier may see. Narrowing it to the parties who share a mission is
 * T-098's to weigh. It is therefore tested for what it shows, not for hiding.
 */
const PUBLIC_TO_EVERY_WORKSPACE = ['customer_profiles'];

const SCOPED = Object.entries(TABLE_CLASSES)
  .filter(
    ([, s]) =>
      s.class === 'tenancy' ||
      s.class === 'tenant_owned' ||
      s.class === 'two_party' ||
      s.class === 'platform_record',
  )
  .map(([table]) => table)
  .sort();

describe('the isolation matrix', () => {
  let app: postgres.Sql;
  let scoped: postgres.Sql;
  let owner: postgres.Sql;
  let platform: PlatformContext;
  let graph: SeededGraph;
  /** A workspace with no part in any of it. */
  let outsider: ExecutionContext;
  let privileges: Map<string, Set<string>>;

  beforeAll(async () => {
    app = testPool({ max: 2 });
    scoped = scopedClient(app);
    owner = testPool({ max: 2, role: 'owner' });
    platform = new PlatformContext(new AuditService(drizzle(scoped, { schema })));
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
    // postgres.js types `begin` as unwrapping an array result; these callbacks return rows, and
    // the value is what the callback returned either way.
    (context === undefined
      ? app.begin(fn)
      : runInContext(context, () => scoped.begin(fn))) as Promise<T>;

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
      // The notes and tasks in the graph are shared and written by the supplier's user, so both
      // parties read them (T-032).
      for (const table of [
        'quotes',
        'assignments',
        'assignment_status_history',
        'investigation_notes',
        'investigation_tasks',
      ]) {
        expect(await rowsSeen(customer, table)).toBe(1);
        expect(await rowsSeen(supplier, table)).toBe(1);
        expect(await rowsSeen(outsider, table)).toBe(0);
      }
    });
  });

  describe('an agency’s profile (T-084)', () => {
    const visible = async (
      context: ExecutionContext,
      table: string,
      column: string,
      value: string,
    ) => {
      const [row] = await as(context, (tx) =>
        tx.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [
          value,
        ]),
      );
      return row!.n;
    };

    it('shows a published profile, its agency and its logo to any workspace — never its settings', async () => {
      const agencyId = graph.rows['tenant_profiles']!;
      expect(await visible(outsider, 'tenants', 'id', agencyId)).toBe(0);
      expect(await visible(outsider, 'media_assets', 'id', graph.agencyLogo)).toBe(0);
      await owner`UPDATE tenant_profiles SET published_at = now() WHERE tenant_id = ${agencyId}`;
      try {
        expect(await rowsSeen(outsider, 'tenant_profiles')).toBe(1);
        expect(await visible(outsider, 'tenants', 'id', agencyId)).toBe(1);
        expect(await visible(outsider, 'media_assets', 'id', graph.agencyLogo)).toBe(1);
        expect(await rowsSeen(outsider, 'tenant_settings')).toBe(0);
        // The supplier's verification document is in another workspace, and no profile names it.
        expect(await rowsSeen(outsider, 'media_assets')).toBe(0);
      } finally {
        await owner`UPDATE tenant_profiles SET published_at = NULL WHERE tenant_id = ${agencyId}`;
      }
      expect(await visible(outsider, 'media_assets', 'id', graph.agencyLogo)).toBe(0);
    });

    it('shows a published agency’s image only while the profile names it', async () => {
      const agencyId = graph.rows['tenant_profiles']!;
      await owner`UPDATE tenant_profiles SET published_at = now(), logo_media_id = NULL
                   WHERE tenant_id = ${agencyId}`;
      try {
        expect(await visible(outsider, 'media_assets', 'id', graph.agencyLogo)).toBe(0);
      } finally {
        await owner`UPDATE tenant_profiles SET published_at = NULL, logo_media_id = ${graph.agencyLogo}
                     WHERE tenant_id = ${agencyId}`;
      }
    });
  });

  describe('joining an agency by invitation (T-085)', () => {
    /** A person with a confirmed address, their Personal workspace as their context. */
    const person = async () => {
      const who = await member(owner);
      const [row] = await owner<
        { email: string }[]
      >`SELECT email FROM users WHERE id = ${who.actor.userId}`;
      return { ...who, email: row!.email, context: await personalContext(owner, who.actor.userId) };
    };

    /** An invitation into `tenantId` for `email`, written by the owner as the service would. */
    const invitation = async (
      tenantId: string,
      email: string,
      over: { role?: string; status?: string; expires?: string } = {},
    ) => {
      const [row] = await owner<{ id: string }[]>`
        INSERT INTO tenant_invitations (tenant_id, email, role_id, token_hash, status, expires_at,
                                        invited_by, cancelled_at)
        SELECT ${tenantId}, ${email}, r.id, ${randomUUID()}, ${over.status ?? 'PENDING'}::invitation_status,
               now() + ${over.expires ?? '1 day'}::interval, ${graph.supplier.userId},
               CASE WHEN ${over.status ?? 'PENDING'} = 'CANCELLED' THEN now() END
          FROM roles r WHERE r.key = ${over.role ?? 'VIEWER'} AND r.tenant_id IS NULL
        RETURNING id`;
      return row!.id;
    };

    const join = (context: ExecutionContext, tenantId: string, userId: string, status = 'ACTIVE') =>
      as(
        context,
        (tx) => tx<{ id: string }[]>`
        INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id, status)
        VALUES (${tenantId}, 'AGENCY', ${userId}, ${status}::membership_status) RETURNING id`,
      );

    const grant = (context: ExecutionContext, membershipId: string, role: string) =>
      as(
        context,
        (tx) => tx`
        INSERT INTO membership_roles (membership_id, role_id)
        SELECT ${membershipId}, id FROM roles WHERE key = ${role} AND tenant_id IS NULL`,
      );

    /** An agency owned by someone outside the graph, so no graph user's memberships change. */
    const newAgency = async (...others: string[]) =>
      agency(owner, [
        { userId: (await person()).actor.userId },
        ...others.map((userId) => ({ userId })),
      ]);

    it('lets a person join with a live invitation for their address — as themselves, with its role only', async () => {
      const { tenantId } = await newAgency();
      const p = await person();
      await invitation(tenantId, p.email.toUpperCase());
      // Not someone else, and not straight into suspension.
      const other = await person();
      await expect(join(p.context, tenantId, other.actor.userId)).rejects.toThrow(
        /row-level security/,
      );
      await expect(join(p.context, tenantId, p.actor.userId, 'SUSPENDED')).rejects.toThrow(
        /row-level security/,
      );
      const [joined] = await join(p.context, tenantId, p.actor.userId);
      await expect(grant(p.context, joined!.id, 'ADMIN')).rejects.toThrow(/row-level security/);
      await grant(p.context, joined!.id, 'VIEWER');
      const [row] = await owner<{ roles: string[] }[]>`
        SELECT array_agg(r.key) AS roles FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.membership_id = ${joined!.id}`;
      expect(row!.roles).toEqual(['VIEWER']);
    });

    it('lets nobody join without one: none, another address, expired, cancelled, unconfirmed', async () => {
      const { tenantId } = await newAgency();
      const cases: Array<[string, (p: Awaited<ReturnType<typeof person>>) => Promise<unknown>]> = [
        ['none', async () => undefined],
        ['another address', async () => invitation(tenantId, `else-${randomUUID()}@example.test`)],
        ['expired', async (p) => invitation(tenantId, p.email, { expires: '-1 minute' })],
        ['cancelled', async (p) => invitation(tenantId, p.email, { status: 'CANCELLED' })],
        [
          'unconfirmed',
          async (p) => {
            await owner`UPDATE users SET email_verified_at = NULL WHERE id = ${p.actor.userId}`;
            return invitation(tenantId, p.email);
          },
        ],
      ];
      for (const [name, arrange] of cases) {
        const p = await person();
        await arrange(p);
        await expect(join(p.context, tenantId, p.actor.userId), name).rejects.toThrow(
          /row-level security/,
        );
      }
    });

    it('shows the invitee their own pending invitation and nothing else, and lets them only accept it', async () => {
      const { tenantId } = await newAgency();
      const p = await person();
      const mine = await invitation(tenantId, p.email);
      const theirs = await invitation(tenantId, `other-${randomUUID()}@example.test`);
      const seen = await as(
        p.context,
        (tx) => tx<{ id: string }[]>`
        SELECT id FROM tenant_invitations WHERE id IN (${mine}, ${theirs})`,
      );
      expect(seen.map((r) => r.id)).toEqual([mine]);
      const someoneElse = (await person()).actor.userId;
      // Not accepted for somebody else, not kept alive longer, not anyone else's.
      await expect(
        as(
          p.context,
          (tx) => tx`
          UPDATE tenant_invitations SET status = 'ACCEPTED', accepted_by = ${someoneElse},
                 accepted_at = now() WHERE id = ${mine}`,
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        as(
          p.context,
          (tx) => tx`
          UPDATE tenant_invitations SET expires_at = now() + interval '1 year' WHERE id = ${mine}`,
        ),
      ).rejects.toThrow(/row-level security/);
      const touched = await as(
        p.context,
        (tx) => tx`
        UPDATE tenant_invitations SET status = 'ACCEPTED', accepted_by = ${p.actor.userId},
               accepted_at = now() WHERE id = ${theirs}`,
      );
      expect(touched.count).toBe(0);
      await as(
        p.context,
        (tx) => tx`
        UPDATE tenant_invitations SET status = 'ACCEPTED', accepted_by = ${p.actor.userId},
               accepted_at = now() WHERE id = ${mine}`,
      );
      const [row] = await owner<
        { status: string }[]
      >`SELECT status FROM tenant_invitations WHERE id = ${mine}`;
      expect(row!.status).toBe('ACCEPTED');
    });

    it('brings a removed member back with an invitation — never a suspended one', async () => {
      const p = await person();
      const { tenantId, memberships } = await newAgency(p.actor.userId);
      await invitation(tenantId, p.email);
      const rejoin = () =>
        as(
          p.context,
          (tx) => tx`
          UPDATE tenant_memberships SET status = 'ACTIVE' WHERE id = ${memberships[1]!}`,
        );
      await owner`UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE id = ${memberships[1]!}`;
      expect((await rejoin()).count).toBe(0);
      await owner`UPDATE tenant_memberships SET status = 'REMOVED' WHERE id = ${memberships[1]!}`;
      expect((await rejoin()).count).toBe(1);
    });

    it('lets a workspace give roles to its own members only, and add nobody itself', async () => {
      const admin = await person();
      const a = await newAgency(admin.actor.userId);
      const b = await newAgency();
      const inA = await agencyContext(owner, admin.actor.userId, a.tenantId);
      await grant(inA, a.memberships[1]!, 'MANAGER');
      await expect(grant(inA, b.memberships[0]!, 'VIEWER')).rejects.toThrow(/row-level security/);
      const stranger = await person();
      await expect(join(inA, a.tenantId, stranger.actor.userId)).rejects.toThrow(
        /row-level security/,
      );
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
        platform.asStaff(
          staff as never,
          { scope: 'VERIFICATION', purpose: 'verification.review' },
          {},
          async () => {
            // Through `begin`, like every query the application makes: a bare tagged template on
            // the pool is the unscoped path, and carries no context at all.
            const rows = await scoped.begin(
              (tx) =>
                tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM verification_requests
                 WHERE id = ${graph.rows['verification_requests']!}`,
            );
            return (rows[0] as unknown as { n: number }).n;
          },
        ),
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

    it('lets a user create an agency for themselves, and never for anybody else', async () => {
      // T-083 opened exactly one more door in the tenancy policies: an agency whose `created_by`
      // is the caller, while it is being set up — with its owner membership and OWNER role, which
      // is the whole path the service takes. Everything either side of that stays shut.
      const mine = await runInContext(outsider, () =>
        scoped.begin(async (tx) => {
          const [created] = await tx<{ id: string }[]>`
            INSERT INTO tenants (kind, status, name, created_by)
            VALUES ('AGENCY', 'CREATING', 'Mine', ${outsider.userId}) RETURNING id`;
          const [membership] = await tx<{ id: string }[]>`
            INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id, status)
            VALUES (${created!.id}, 'AGENCY', ${outsider.userId}, 'ACTIVE') RETURNING id`;
          await tx`
            INSERT INTO membership_roles (membership_id, role_id)
            SELECT ${membership!.id}, id FROM roles WHERE key = 'OWNER' AND tenant_id IS NULL`;
          return created!.id;
        }),
      );
      const [landed] = await owner<{ created_by: string }[]>`
        SELECT created_by FROM tenants WHERE id = ${mine as string}`;
      expect(landed!.created_by).toBe(outsider.userId);

      await expect(
        runInContext(outsider, () =>
          scoped.begin(
            (tx) => tx`
              INSERT INTO tenants (kind, status, name, created_by)
              VALUES ('AGENCY', 'CREATING', 'Theirs', ${graph.supplier.userId})`,
          ),
        ),
      ).rejects.toThrow(/row-level security/);

      // Nor may it arrive already ACTIVE, skipping the window in which it is being set up.
      await expect(
        runInContext(outsider, () =>
          scoped.begin(
            (tx) => tx`
              INSERT INTO tenants (kind, status, name, country_code, business_email, timezone,
                                   currency, created_by)
              VALUES ('AGENCY', 'ACTIVE', 'Born active', 'AM', 'a@b.test', 'UTC', 'AMD',
                      ${outsider.userId})`,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('lets nobody join an agency they did not create', async () => {
      // Joining an existing agency is an invitation (T-085) — somebody else's decision, not the
      // joiner's. The membership policy is what makes that true rather than a convention.
      const { tenantId } = await agency(owner, [{ userId: graph.supplier.userId }]);
      await expect(
        runInContext(outsider, () =>
          scoped.begin(
            (tx) => tx`
              INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id, status)
              VALUES (${tenantId}, 'AGENCY', ${outsider.userId}, 'ACTIVE')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
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
