import type postgres from 'postgres';

/**
 * Why the API refuses to run as a privileged role (T-073, ADR-0011).
 *
 * Row-level security does not apply to a superuser, to a role with BYPASSRLS, or to a table's
 * owner. An API connected as any of them would pass every isolation test written against it
 * while protecting nothing, because the policies it is tested against never fire. So the check
 * is at boot, and it fails closed: an environment configured with the owner's credentials does
 * not start at all, rather than starting unprotected.
 *
 * "Can act as" matters as much as "is": a role that may `SET ROLE` into a superuser or a table
 * owner is one statement away from bypassing everything, so membership counts.
 */
export async function runtimeRoleProblems(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<{ role: string; problems: string[] }> {
  const [row] = await sql<
    {
      role: string;
      superuser: boolean;
      bypassrls: boolean;
      privileged: string | null;
      owned: string | null;
      ownedCount: number;
    }[]
  >`
    SELECT current_user AS role,
           r.rolsuper AS superuser,
           r.rolbypassrls AS bypassrls,
           (SELECT string_agg(p.rolname, ', ' ORDER BY p.rolname)
              FROM pg_roles p
             WHERE p.rolname <> current_user
               AND (p.rolsuper OR p.rolbypassrls)
               AND pg_has_role(current_user, p.oid, 'MEMBER')) AS privileged,
           (SELECT string_agg(t.relname, ', ')
              FROM (SELECT c.relname
                      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public'
                       AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
                       AND pg_has_role(current_user, c.relowner, 'MEMBER')
                     ORDER BY c.relname
                     LIMIT 5) t) AS owned,
           (SELECT count(*)::int
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
               AND pg_has_role(current_user, c.relowner, 'MEMBER')) AS "ownedCount"
      FROM pg_roles r
     WHERE r.rolname = current_user`;

  const r = row!;
  const problems: string[] = [];
  if (r.superuser) problems.push('is a superuser');
  if (r.bypassrls) problems.push('has BYPASSRLS');
  if (r.privileged !== null)
    problems.push(`can act as ${r.privileged}, which bypass row-level security`);
  if (r.ownedCount > 0) {
    const more = r.ownedCount > 5 ? ` and ${r.ownedCount - 5} more` : '';
    problems.push(`owns, or can act as the owner of, ${r.owned}${more}`);
  }
  return { role: r.role, problems };
}

/** Throws with an actionable message when the connection's role could bypass row-level security. */
export async function assertRuntimeRole(sql: postgres.Sql): Promise<void> {
  const { role, problems } = await runtimeRoleProblems(sql);
  if (problems.length === 0) return;
  throw new Error(
    `Refusing to start: the database role "${role}" ${problems.join('; ')}. ` +
      'Row-level security would not apply to it. DATABASE_URL must use the runtime role ' +
      '(investigator_app); migrations use MIGRATION_DATABASE_URL. ' +
      'See docs/architecture/tenancy.md §7.',
  );
}
