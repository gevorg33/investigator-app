import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import {
  membershipRoles,
  permissions,
  rolePermissions,
  roles,
  tenantMemberships,
  tenants,
} from './tenants';
import { userSessions, users } from './users';

/**
 * Workspaces and memberships (T-074), proved against the applied schema. Setup runs as the
 * owner inside transactions that are rolled back, except where a test must see a commit —
 * the owner rule is checked at commit, so those write real rows under fresh ids.
 */
class RollbackSignal extends Error {}

describe('workspaces and memberships', () => {
  let owner: postgres.Sql;
  let app: postgres.Sql;

  beforeAll(() => {
    owner = testPool({ max: 3, role: 'owner' });
    app = testPool({ max: 1 });
  });

  afterAll(async () => {
    await owner.end();
    await app.end();
  });

  const probe = async (body: (tx: postgres.TransactionSql) => Promise<unknown>) =>
    owner
      .begin(async (tx) => {
        await body(tx);
        throw new RollbackSignal();
      })
      .catch((e: unknown) => {
        if (!(e instanceof RollbackSignal)) throw e;
      });

  const newUser = async (db: postgres.Sql | postgres.TransactionSql) => {
    const [u] = await db<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`ws-${randomUUID()}@example.test`}) RETURNING id`;
    return u!.id;
  };

  const personalOf = async (db: postgres.Sql | postgres.TransactionSql, userId: string) => {
    const [row] = await db<
      { tenantId: string; membershipId: string; status: string; roles: string[] }[]
    >`
      SELECT t.id AS "tenantId", m.id AS "membershipId", t.status,
             array(SELECT r.key FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
                    WHERE mr.membership_id = m.id ORDER BY r.key) AS roles
        FROM tenants t JOIN tenant_memberships m ON m.tenant_id = t.id
       WHERE t.personal_owner_id = ${userId}`;
    return row;
  };

  /** An agency with the given members; the first is its OWNER. Committed. */
  const agency = async (members: string[]) => {
    return owner.begin(async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        INSERT INTO tenants (kind, status, name, country_code, business_email, timezone, currency)
        VALUES ('AGENCY', 'ACTIVE', 'Probe Agency', 'AM', 'probe@example.test', 'Asia/Yerevan', 'AMD')
        RETURNING id`;
      const ids: string[] = [];
      for (const userId of members) {
        const [m] = await tx<{ id: string }[]>`
          INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id)
          VALUES (${t!.id}, 'AGENCY', ${userId}) RETURNING id`;
        ids.push(m!.id);
      }
      await tx`
        INSERT INTO membership_roles (membership_id, role_id)
        SELECT ${ids[0]!}, id FROM roles WHERE key = 'OWNER' AND tenant_id IS NULL`;
      return { tenantId: t!.id, membershipIds: ids };
    });
  };

  const grantOwner = (db: postgres.Sql | postgres.TransactionSql, membershipId: string) => db`
    INSERT INTO membership_roles (membership_id, role_id)
    SELECT ${membershipId}, id FROM roles WHERE key = 'OWNER' AND tenant_id IS NULL`;
  const revokeOwner = (db: postgres.Sql | postgres.TransactionSql, membershipId: string) => db`
    DELETE FROM membership_roles
     WHERE membership_id = ${membershipId}
       AND role_id = (SELECT id FROM roles WHERE key = 'OWNER' AND tenant_id IS NULL)`;

  describe('a Personal workspace for every user', () => {
    it('is created with the user, in the same statement, when the runtime role inserts it', async () => {
      // As investigator_app: the trigger runs with the invoker's privileges, never elevated,
      // so registration works only because the runtime role may do each step itself.
      const userId = await newUser(app);
      expect(await personalOf(owner, userId)).toMatchObject({ status: 'ACTIVE', roles: ['OWNER'] });
    });

    it('is refused a second one', async () => {
      await expect(
        probe(async (tx) => {
          const userId = await newUser(tx);
          await tx`INSERT INTO tenants (kind, status, personal_owner_id) VALUES ('PERSONAL', 'ACTIVE', ${userId})`;
        }),
      ).rejects.toThrow(/tenants_one_personal_per_user/);
    });

    it('holds only the person it belongs to', async () => {
      await expect(
        probe(async (tx) => {
          const [a, b] = [await newUser(tx), await newUser(tx)];
          const ws = await personalOf(tx, a);
          await tx`
            INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id)
            VALUES (${ws!.tenantId}, 'PERSONAL', ${b})`;
        }),
      ).rejects.toThrow(/tenant_memberships_personal_is_owner/);
    });

    it('never gains a second member even with that trigger gone — the index is the backstop', async () => {
      await expect(
        probe(async (tx) => {
          // Disabled before any insert: a table with pending deferred trigger events cannot be altered.
          await tx`ALTER TABLE tenant_memberships DISABLE TRIGGER tenant_memberships_personal_is_owner`;
          const [a, b] = [await newUser(tx), await newUser(tx)];
          const ws = await personalOf(tx, a);
          await tx`
            INSERT INTO tenant_memberships (tenant_id, tenant_kind, user_id)
            VALUES (${ws!.tenantId}, 'PERSONAL', ${b})`;
        }),
      ).rejects.toThrow(/tenant_memberships_one_per_personal/);
    });

    it('goes with its user when the retention workflow deletes them', async () => {
      const userId = await newUser(owner);
      const ws = await personalOf(owner, userId);
      await owner`DELETE FROM users WHERE id = ${userId}`;
      expect(await owner`SELECT 1 FROM tenants WHERE id = ${ws!.tenantId}`).toHaveLength(0);
    });

    it('does not let an agency membership disappear with its user', async () => {
      const [a, b] = [await newUser(owner), await newUser(owner)];
      await agency([a, b]);
      // Checked at commit, after the Personal workspace has cascaded: the agency membership is
      // still there, so the delete is refused. The retention workflow handles it deliberately.
      await expect(owner`DELETE FROM users WHERE id = ${b}`).rejects.toThrow(
        /tenant_memberships_user_id_users_id_fk/,
      );
    });
  });

  describe('an agency is usable only when it is complete', () => {
    // The service decides when to activate; this is what stops anything else — a fixture, a
    // migration, a later endpoint — from activating a workspace nobody can be billed at or
    // written to (T-083).
    it.each([
      ['country', 'country_code'],
      ['business email', 'business_email'],
      ['time zone', 'timezone'],
      ['currency', 'currency'],
    ])('refuses an ACTIVE agency with no %s', async (_label, column) => {
      const columns = ['country_code', 'business_email', 'timezone', 'currency'];
      const values: Record<string, string> = {
        country_code: 'AM',
        business_email: 'agency@example.test',
        timezone: 'Asia/Yerevan',
        currency: 'AMD',
      };
      const present = columns.filter((c) => c !== column);
      await expect(
        probe((tx) =>
          tx.unsafe(
            `INSERT INTO tenants (kind, status, name, ${present.join(', ')})
             VALUES ('AGENCY', 'ACTIVE', 'Incomplete', ${present.map((c) => `'${values[c]!}'`).join(', ')})`,
          ),
        ),
      ).rejects.toThrow(/tenants_active_agency_is_complete/);
    });

    it('refuses activating one that is still missing something', async () => {
      await expect(
        probe(async (tx) => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO tenants (kind, status, name, country_code)
            VALUES ('AGENCY', 'CREATING', 'Half done', 'AM') RETURNING id`;
          await tx`UPDATE tenants SET status = 'ACTIVE' WHERE id = ${row!.id}`;
        }),
      ).rejects.toThrow(/tenants_active_agency_is_complete/);
    });

    it.each([
      ['a country that is not a code', "country_code = 'Armenia'"],
      ['a currency that is not a code', "currency = 'dram'"],
    ])('refuses %s', async (_label, assignment) => {
      await expect(
        probe((tx) =>
          tx.unsafe(
            `INSERT INTO tenants (kind, status, name, ${assignment.split(' = ')[0]})
             VALUES ('AGENCY', 'CREATING', 'Bad code', ${assignment.split(' = ')[1]})`,
          ),
        ),
      ).rejects.toThrow(/tenants_(country|currency)_is_iso/);
    });
  });

  describe('every workspace has an active owner', () => {
    it('refuses to commit an agency created without one', async () => {
      await expect(
        owner.begin(async (tx) => {
          await tx`
            INSERT INTO tenants (kind, status, name, country_code, business_email, timezone, currency)
            VALUES ('AGENCY', 'ACTIVE', 'Ownerless', 'AM', 'ownerless@example.test', 'Asia/Yerevan', 'AMD')`;
        }),
      ).rejects.toThrow(/tenant_has_active_owner/);
    });

    it.each([
      [
        'removing the OWNER role',
        (_db: postgres.TransactionSql, _m: string) => revokeOwner(_db, _m),
      ],
      [
        'suspending the owner',
        (db: postgres.TransactionSql, m: string) =>
          db`UPDATE tenant_memberships SET status = 'SUSPENDED' WHERE id = ${m}`,
      ],
      [
        'removing the owner',
        (db: postgres.TransactionSql, m: string) =>
          db`UPDATE tenant_memberships SET status = 'REMOVED' WHERE id = ${m}`,
      ],
      [
        'deleting the owner’s membership',
        (db: postgres.TransactionSql, m: string) =>
          db`DELETE FROM tenant_memberships WHERE id = ${m}`,
      ],
    ])('refuses %s when they are the last', async (_label, act) => {
      const { membershipIds } = await agency([await newUser(owner), await newUser(owner)]);
      await expect(owner.begin((tx) => act(tx, membershipIds[0]!))).rejects.toThrow(
        /tenant_has_active_owner/,
      );
    });

    it('refuses to remove the owner of a Personal workspace', async () => {
      const ws = await personalOf(owner, await newUser(owner));
      await expect(owner.begin((tx) => revokeOwner(tx, ws!.membershipId))).rejects.toThrow(
        /tenant_has_active_owner/,
      );
    });

    it('lets ownership move within one transaction', async () => {
      const { membershipIds } = await agency([await newUser(owner), await newUser(owner)]);
      await owner.begin(async (tx) => {
        await revokeOwner(tx, membershipIds[0]!); // briefly nobody — fine until commit
        await grantOwner(tx, membershipIds[1]!);
      });
      const holders = await owner<{ id: string }[]>`
        SELECT mr.membership_id AS id FROM membership_roles mr
          JOIN roles r ON r.id = mr.role_id AND r.key = 'OWNER'
         WHERE mr.membership_id IN ${owner(membershipIds)}`;
      expect(holders.map((h) => h.id)).toEqual([membershipIds[1]]);
    });

    it('never ends with nobody when two owners are removed at once', async () => {
      // Two owners, each removed by a different transaction at the same moment. Without the
      // lock in the check, each would see the other still there and both would commit.
      const { membershipIds } = await agency([await newUser(owner), await newUser(owner)]);
      await grantOwner(owner, membershipIds[1]!);

      // Both remove; then each runs the owner check (SET CONSTRAINTS ... IMMEDIATE) and waits
      // until both checks have finished before committing — so the checks cannot be separated by
      // a commit. Without the lock, each sees the other's owner still there, uncommitted: both
      // pass, both commit, nobody is left. With it, the second check waits on the first
      // transaction's lock, so it cannot finish; after a moment the first commits, and the
      // second then sees no owner and is refused.
      let release!: () => void;
      const bothRemoved = new Promise<void>((r) => (release = r));
      let checkedRelease!: () => void;
      const bothChecked = new Promise<void>((r) => (checkedRelease = r));
      let removed = 0;
      let checked = 0;
      const attempt = (m: string) =>
        owner.begin(async (tx) => {
          await revokeOwner(tx, m);
          if (++removed === 2) release();
          await bothRemoved;
          await tx`SET CONSTRAINTS ALL IMMEDIATE`;
          if (++checked === 2) checkedRelease();
          await Promise.race([bothChecked, new Promise((r) => setTimeout(r, 1000))]);
        });

      const results = await Promise.allSettled([
        attempt(membershipIds[0]!),
        attempt(membershipIds[1]!),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const remaining = await owner`
        SELECT 1 FROM membership_roles mr JOIN roles r ON r.id = mr.role_id AND r.key = 'OWNER'
         WHERE mr.membership_id IN ${owner(membershipIds)}`;
      expect(remaining).toHaveLength(1);
    });
  });

  describe('identity never changes', () => {
    it.each([
      [
        'a workspace’s kind',
        `UPDATE tenants SET kind = 'AGENCY', name = 'x', personal_owner_id = NULL WHERE id = $1`,
        'tenants_identity_immutable',
      ],
      [
        'who a membership is for',
        `UPDATE tenant_memberships SET user_id = gen_random_uuid() WHERE tenant_id = $1`,
        'tenant_memberships_identity_immutable',
      ],
    ])('refuses to change %s', async (_label, statement, constraint) => {
      await expect(
        probe(async (tx) => {
          const ws = await personalOf(tx, await newUser(tx));
          await tx.unsafe(statement, [ws!.tenantId]);
        }),
      ).rejects.toThrow(new RegExp(constraint));
    });
  });

  describe('shape', () => {
    it.each([
      [
        'a Personal workspace with a name',
        `INSERT INTO tenants (kind, status, personal_owner_id, name) VALUES ('PERSONAL', 'ACTIVE', $1, 'x')`,
        'tenants_name_by_kind',
      ],
      [
        'an agency with no name',
        `INSERT INTO tenants (kind, status) VALUES ('AGENCY', 'CREATING')`,
        'tenants_name_by_kind',
      ],
      [
        'an agency with a blank name',
        `INSERT INTO tenants (kind, status, name) VALUES ('AGENCY', 'CREATING', '   ')`,
        'tenants_name_by_kind',
      ],
      [
        'a Personal workspace with no owner',
        `INSERT INTO tenants (kind, status) VALUES ('PERSONAL', 'ACTIVE')`,
        'tenants_personal_has_owner',
      ],
      [
        'an agency with a Personal owner',
        `INSERT INTO tenants (kind, status, name, personal_owner_id) VALUES ('AGENCY', 'CREATING', 'x', $1)`,
        'tenants_personal_has_owner',
      ],
    ])('refuses %s', async (_label, statement, constraint) => {
      await expect(
        probe(async (tx) => {
          const userId = await newUser(tx);
          await tx`DELETE FROM tenants WHERE personal_owner_id = ${userId}`;
          await tx.unsafe(statement, statement.includes('$1') ? [userId] : []);
        }),
      ).rejects.toThrow(new RegExp(constraint));
    });
  });

  describe('the permission catalog', () => {
    /** tenancy.md §3, parsed — the document is the specification, the seed must match it. */
    const specified = (): Map<string, Set<string>> => {
      const doc = readFileSync(
        join(__dirname, '../../../../../docs/architecture/tenancy.md'),
        'utf8',
      );
      const section = doc.slice(doc.indexOf('## 3. Roles and permissions'), doc.indexOf('## 4.'));
      const roles = ['OWNER', 'ADMIN', 'MANAGER', 'INVESTIGATOR', 'AGENCY_STAFF', 'VIEWER'];
      const grants = new Map(roles.map((r) => [r, new Set<string>()]));
      for (const line of section.split('\n').filter((l) => l.startsWith('| `'))) {
        const cells = line
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
        const keys = [...cells[0]!.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((m) => m[1]!);
        roles.forEach((role, i) => {
          const cell = cells[i + 1]!;
          const held = cell.startsWith('✓')
            ? keys
            : cell === 'read'
              ? keys.filter((k) => k.endsWith('.read'))
              : [];
          for (const k of held) grants.get(role)!.add(k);
        });
      }
      return grants;
    };

    it('grants exactly what tenancy.md §3 specifies, role by role', async () => {
      const rows = await owner<{ role: string; permission: string }[]>`
        SELECT r.key AS role, rp.permission_key AS permission
          FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
         WHERE r.tenant_id IS NULL`;
      const seeded = new Map<string, string[]>();
      for (const { role, permission } of rows)
        seeded.set(role, [...(seeded.get(role) ?? []), permission]);
      for (const [role, keys] of specified()) {
        expect([...(seeded.get(role) ?? [])].sort(), role).toEqual([...keys].sort());
      }
      expect([...seeded.keys()].sort()).toEqual([...specified().keys()].sort());
    });

    it('describes every permission the matrix names, and no others', async () => {
      const all = new Set([...specified().values()].flatMap((s) => [...s]));
      const rows = await owner<{ key: string }[]>`SELECT key FROM permissions ORDER BY key`;
      expect(rows.map((r) => r.key)).toEqual([...all].sort());
    });
  });

  describe('privileges of the runtime role', () => {
    const granted = async (table: string): Promise<string[]> => {
      const rows = await owner<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'investigator_app' AND table_name = ${table}
         ORDER BY privilege_type`;
      return rows.map((r) => r.privilege_type);
    };

    it.each([
      ['tenants', ['INSERT', 'SELECT', 'UPDATE']],
      ['tenant_memberships', ['INSERT', 'SELECT', 'UPDATE']],
      ['membership_roles', ['DELETE', 'INSERT', 'SELECT']],
      ['permissions', ['SELECT']],
      ['roles', ['SELECT']],
      ['role_permissions', ['SELECT']],
    ])('%s: %j', async (table, expected) => {
      expect(await granted(table)).toEqual(expected);
    });

    it('cannot write the catalog', async () => {
      await expect(
        app`INSERT INTO permissions (key, description) VALUES ('x.y', 'z')`,
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('the triggers themselves', () => {
    it('run with the invoker’s privileges and a fixed search_path', async () => {
      const rows = await owner<{ name: string; definer: boolean; config: string[] | null }[]>`
        SELECT proname AS name, prosecdef AS definer, proconfig AS config FROM pg_proc
         WHERE proname IN ('create_personal_workspace', 'assert_tenant_has_owner',
                           'assert_personal_member_is_owner', 'forbid_identity_change')
         ORDER BY proname`;
      expect(rows).toHaveLength(4);
      for (const r of rows) {
        expect(r.definer, r.name).toBe(false);
        expect(r.config, r.name).toContain('search_path=pg_catalog, public');
      }
    });
  });
});

/**
 * The references and what deleting does to them. Deliberate, and easy to get wrong: a user's
 * deletion must take their empty Personal workspace with it, and nothing else.
 */
describe('workspace references', () => {
  const refs = (table: PgTable) =>
    getTableConfig(table).foreignKeys.map((f) => ({
      columns: f.reference().columns.map((c) => c.name),
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));

  it('a Personal workspace goes with its user', () => {
    expect(refs(tenants)).toEqual([
      { columns: ['personal_owner_id'], target: users, onDelete: 'cascade' },
    ]);
  });

  it('a membership goes with its workspace, and its user check waits for commit', () => {
    expect(refs(tenantMemberships)).toEqual(
      expect.arrayContaining([
        { columns: ['user_id'], target: users, onDelete: 'no action' },
        { columns: ['tenant_id', 'tenant_kind'], target: tenants, onDelete: 'cascade' },
      ]),
    );
  });

  it('role assignments go with the membership; a role in use cannot be deleted', () => {
    expect(refs(membershipRoles)).toEqual(
      expect.arrayContaining([
        { columns: ['membership_id'], target: tenantMemberships, onDelete: 'cascade' },
        { columns: ['role_id'], target: roles, onDelete: 'restrict' },
      ]),
    );
    expect(refs(rolePermissions)).toEqual(
      expect.arrayContaining([
        { columns: ['role_id'], target: roles, onDelete: 'cascade' },
        { columns: ['permission_key'], target: permissions, onDelete: 'restrict' },
      ]),
    );
    expect(refs(roles)).toEqual([{ columns: ['tenant_id'], target: tenants, onDelete: 'cascade' }]);
  });

  it('a session’s default workspace clears if the workspace ever goes', () => {
    expect(refs(userSessions)).toEqual(
      expect.arrayContaining([
        { columns: ['default_tenant_id'], target: tenants, onDelete: 'set null' },
      ]),
    );
  });
});
