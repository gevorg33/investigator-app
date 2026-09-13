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

class RollbackSignal extends Error {}
