import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../../../database/database.module';
import { membershipRoles, rolePermissions, roles } from '../../../database/schema';

export interface CatalogRole {
  id: string;
  key: string;
  permissions: readonly string[];
}

/**
 * The permission catalog, as employee management needs it (T-085): which role a key names, what
 * a role grants, and what a member holds.
 *
 * Every question here is answered in **permissions** — never by a role's name. "May this person
 * grant that role?" is "does the role grant anything they do not hold?"; "may they act on that
 * member?" is "does the member hold anything they do not?" (owner decision, 2026-09-27: no granting
 * upward). So a new role, or a changed grant, changes the answers without a line of code, which is
 * why `role-names.spec.ts` allows this file, and only this one in the module, to read the role
 * tables.
 */
@Injectable()
export class EmployeeRoles {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * The system roles — and later this workspace's own — by key, with what each grants. Never asked
   * with no keys: an invitation names one role, and a role change at least one (the DTOs).
   */
  async byKeys(keys: readonly string[], db: Db | Tx = this.db): Promise<CatalogRole[]> {
    const rows = await db
      .select({ id: roles.id, key: roles.key, permission: rolePermissions.permissionKey })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(
        and(
          inArray(roles.key, [...keys]),
          or(isNull(roles.tenantId), eq(roles.tenantId, sql`app_current_tenant()`)),
        ),
      );
    return group(rows);
  }

  /** One role by id, with what it grants. */
  async byId(id: string, db: Db | Tx = this.db): Promise<CatalogRole | undefined> {
    const rows = await db
      .select({ id: roles.id, key: roles.key, permission: rolePermissions.permissionKey })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(roles.id, id));
    return group(rows)[0];
  }

  /** Each membership's roles, keyed by membership id: the keys shown, the permissions held. */
  async ofMemberships(
    membershipIds: readonly string[],
    db: Db | Tx = this.db,
  ): Promise<Map<string, CatalogRole[]>> {
    const out = new Map<string, CatalogRole[]>();
    const rows = await db
      .select({
        membershipId: membershipRoles.membershipId,
        id: roles.id,
        key: roles.key,
        permission: rolePermissions.permissionKey,
      })
      .from(membershipRoles)
      .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(inArray(membershipRoles.membershipId, [...membershipIds]));
    for (const id of membershipIds) {
      out.set(id, group(rows.filter((r) => r.membershipId === id)));
    }
    return out;
  }

  /**
   * Gives a membership exactly these roles — at least one, as the DTO requires: what it has and
   * should not is taken away.
   */
  async replace(membershipId: string, roleIds: readonly string[], tx: Tx): Promise<void> {
    await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
    await tx.insert(membershipRoles).values(roleIds.map((roleId) => ({ membershipId, roleId })));
  }

  /** Takes every role a membership has — for a member who leaves. */
  async clear(membershipId: string, tx: Tx): Promise<void> {
    await tx.delete(membershipRoles).where(eq(membershipRoles.membershipId, membershipId));
  }

  /** Gives a membership one role — the one an invitation carried. */
  async grant(membershipId: string, roleId: string, tx: Tx): Promise<void> {
    await tx.insert(membershipRoles).values({ membershipId, roleId }).onConflictDoNothing();
  }
}

/** Every permission a set of roles grants. */
export const permissionsOf = (held: readonly CatalogRole[]): string[] => [
  ...new Set(held.flatMap((r) => r.permissions)),
];

function group(
  rows: ReadonlyArray<{ id: string; key: string; permission: string | null }>,
): CatalogRole[] {
  const byId = new Map<string, { id: string; key: string; permissions: string[] }>();
  for (const r of rows) {
    const role = byId.get(r.id) ?? { id: r.id, key: r.key, permissions: [] };
    if (r.permission !== null) role.permissions.push(r.permission);
    byId.set(r.id, role);
  }
  return [...byId.values()]
    .map((r) => ({ ...r, permissions: [...r.permissions].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
