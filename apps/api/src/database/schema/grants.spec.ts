import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Proves the append-only grant on audit_logs actually holds.
 *
 * Issuing a GRANT is not the same as the grant working. audit-logging requires that
 * the application role cannot rewrite history, so this connects AS that role and
 * attempts the forbidden statements.
 */
const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

describe('audit_logs is append-only for the application role', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('grants exactly SELECT and INSERT — no UPDATE, no DELETE', async () => {
    const rows = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'investigator_app' AND table_name = 'audit_logs'
      ORDER BY privilege_type`;
    const granted = rows.map((r) => r.privilege_type);
    expect(granted).toEqual(['INSERT', 'SELECT']);
    expect(granted).not.toContain('UPDATE');
    expect(granted).not.toContain('DELETE');
  });

  it('allows the application role to INSERT', async () => {
    await sql
      .begin(async (tx) => {
        await tx`SET LOCAL ROLE investigator_app`;
        const [row] = await tx<{ id: string }[]>`
        INSERT INTO audit_logs (action, resource_type)
        VALUES ('test.grant_probe', 'probe') RETURNING id`;
        expect(row?.id).toBeTruthy();
        // Rolled back — the probe must not persist.
        throw new RollbackSignal();
      })
      .catch((e: unknown) => {
        if (!(e instanceof RollbackSignal)) throw e;
      });
  });

  it('refuses UPDATE from the application role', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE investigator_app`;
        await tx`UPDATE audit_logs SET reason = 'tampered'`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses DELETE from the application role', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE investigator_app`;
        await tx`DELETE FROM audit_logs`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('still allows the application role to read', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE investigator_app`;
      return tx`SELECT count(*)::int AS n FROM audit_logs`;
    });
    expect(rows).toHaveLength(1);
  });
});

describe('users.email uniqueness is case-insensitive', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('rejects the same address in different case', async () => {
    // citext, so Bob@Example.com and bob@example.com are one account — otherwise
    // account recovery becomes ambiguous.
    await expect(
      sql.begin(async (tx) => {
        await tx`INSERT INTO users (email) VALUES ('CaseProbe@Example.com')`;
        await tx`INSERT INTO users (email) VALUES ('caseprobe@example.com')`;
      }),
    ).rejects.toThrow(/duplicate key/i);
  });
});

/**
 * The same proof for the mission tables, and it is needed for a reason worth stating.
 *
 * Migration 0000 sets ALTER DEFAULT PRIVILEGES granting SELECT, INSERT, UPDATE and DELETE on
 * every table created in this schema. A new table therefore arrives fully writable, and a
 * narrower GRANT in a later migration changes nothing — withholding a privilege means
 * REVOKING it. Migration 0007 shipped with the GRANTs and without the REVOKEs, and these
 * tests failed against the applied schema: mission_status_history and mission_screenings
 * were both updatable and deletable.
 */
describe('the mission tables hold only the privileges they were meant to', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL, { max: 1, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end();
  });

  const granted = async (table: string): Promise<string[]> => {
    const rows = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'investigator_app' AND table_name = ${table}
      ORDER BY privilege_type`;
    return rows.map((r) => r.privilege_type);
  };

  it.each(['mission_status_history', 'mission_screenings'])('%s is append-only', async (table) => {
    // A status history that can be edited settles no dispute, and a screening result that can
    // be rewritten explains nothing.
    expect(await granted(table)).toEqual(['INSERT', 'SELECT']);
  });

  it.each(['missions', 'outbox_events'])(
    '%s cannot be deleted from by the application',
    async (table) => {
      // Removing a mission is the retention workflow's job; pruning delivered events likewise.
      expect(await granted(table)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    },
  );

  it('refuses UPDATE on mission_status_history from the application role', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE investigator_app`;
        await tx`UPDATE mission_status_history SET reason = 'tampered'`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses DELETE on missions from the application role', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx`SET LOCAL ROLE investigator_app`;
        await tx`DELETE FROM missions`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });
});

class RollbackSignal extends Error {}
