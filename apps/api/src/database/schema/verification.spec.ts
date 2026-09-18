import { randomUUID } from 'node:crypto';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mediaAssets } from './media';
import { investigatorProfiles } from './profiles';
import {
  verificationDecisions,
  verificationRequestDocuments,
  verificationRequests,
} from './verification';

/**
 * The verification tables' own rules, proved against the applied schema rather than read off
 * the migration. Every probe runs in a transaction that is rolled back.
 */
const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

class RollbackSignal extends Error {}

describe('verification tables', () => {
  let sql: postgres.Sql;

  beforeAll(() => {
    sql = postgres(URL, { max: 2, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A profile with one open request, inside `tx`. */
  const seed = async (tx: postgres.TransactionSql) => {
    const [user] = await tx<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`verif-schema-${randomUUID()}@example.test`}) RETURNING id`;
    const [profile] = await tx<{ id: string }[]>`
      INSERT INTO investigator_profiles (user_id) VALUES (${user!.id}) RETURNING id`;
    const [request] = await tx<{ id: string }[]>`
      INSERT INTO verification_requests (profile_id, declared_scope)
      VALUES (${profile!.id}, '{"specialtyNodeIds": [], "serviceAreas": []}') RETURNING id`;
    return { userId: user!.id, profileId: profile!.id, requestId: request!.id };
  };

  /** Runs `body` and rolls back whatever it wrote; a database error propagates. */
  const probe = async (body: (tx: postgres.TransactionSql) => Promise<unknown>) =>
    sql
      .begin(async (tx) => {
        await body(tx);
        throw new RollbackSignal();
      })
      .catch((e: unknown) => {
        if (!(e instanceof RollbackSignal)) throw e;
      });

  describe('privileges of the application role', () => {
    const granted = async (table: string): Promise<string[]> => {
      const rows = await sql<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'investigator_app' AND table_name = ${table}
        ORDER BY privilege_type`;
      return rows.map((r) => r.privilege_type);
    };

    it.each(['verification_request_documents', 'verification_decisions'])(
      '%s is append-only',
      async (table) => {
        expect(await granted(table)).toEqual(['INSERT', 'SELECT']);
      },
    );

    it('verification_requests can be updated but never deleted', async () => {
      expect(await granted('verification_requests')).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    });

    it.each([
      ['rewriting a decision', `UPDATE verification_decisions SET reason = 'tampered'`],
      ['deleting a decision', 'DELETE FROM verification_decisions'],
      [
        'swapping a document',
        'UPDATE verification_request_documents SET media_asset_id = media_asset_id',
      ],
      ['deleting a request', 'DELETE FROM verification_requests'],
    ])('refuses %s as the application role', async (_label, statement) => {
      await expect(
        sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE investigator_app`;
          await tx.unsafe(statement);
        }),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('requests', () => {
    it('holds one open application per profile', async () => {
      await expect(
        probe(async (tx) => {
          const { profileId } = await seed(tx);
          await tx`
            INSERT INTO verification_requests (profile_id, declared_scope)
            VALUES (${profileId}, '{"specialtyNodeIds": [], "serviceAreas": []}')`;
        }),
      ).rejects.toThrow(/verification_requests_one_open_per_profile/);
    });

    it('allows a new application once the last one is decided', async () => {
      await expect(
        probe(async (tx) => {
          const { profileId, requestId } = await seed(tx);
          await tx`
            UPDATE verification_requests SET status = 'REJECTED', decided_at = now()
            WHERE id = ${requestId}`;
          await tx`
            INSERT INTO verification_requests (profile_id, declared_scope)
            VALUES (${profileId}, '{"specialtyNodeIds": [], "serviceAreas": []}')`;
        }),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['decided without a decision time', `status = 'APPROVED'`, 'decided_at_consistent'],
      ['open with a decision time', 'decided_at = now()', 'decided_at_consistent'],
      [
        'decided before it was submitted',
        `status = 'APPROVED', decided_at = submitted_at - interval '1 second'`,
        'decided_after_submitted',
      ],
      ['a version below one', 'version = 0', 'version_positive'],
      ['a declaration that is not an object', `declared_scope = '[]'`, 'declared_scope_shape'],
      [
        'a declaration missing its areas',
        `declared_scope = '{"specialtyNodeIds": []}'`,
        'declared_scope_shape',
      ],
      [
        'a declaration whose specialties are not a list',
        `declared_scope = '{"specialtyNodeIds": "x", "serviceAreas": []}'`,
        'declared_scope_shape',
      ],
    ])('refuses a request %s', async (_label, set, constraint) => {
      await expect(
        probe(async (tx) => {
          const { requestId } = await seed(tx);
          await tx.unsafe(`UPDATE verification_requests SET ${set} WHERE id = $1`, [requestId]);
        }),
      ).rejects.toThrow(new RegExp(`verification_requests_${constraint}`));
    });

    it('keeps a profile while it has applications', async () => {
      await expect(
        probe(async (tx) => {
          const { profileId } = await seed(tx);
          await tx`DELETE FROM investigator_profiles WHERE id = ${profileId}`;
        }),
      ).rejects.toThrow(/violates foreign key constraint/);
    });
  });

  describe('decisions', () => {
    const decide = (tx: postgres.TransactionSql, requestId: string, reason: string) =>
      tx`
        INSERT INTO verification_decisions (request_id, outcome, reason, decided_by)
        VALUES (${requestId}, 'APPROVED', ${reason}, ${randomUUID()})`;

    it('records one decision per request', async () => {
      await expect(
        probe(async (tx) => {
          const { requestId } = await seed(tx);
          await decide(tx, requestId, 'Checked.');
          await decide(tx, requestId, 'Checked again.');
        }),
      ).rejects.toThrow(/verification_decisions_one_per_request/);
    });

    it.each([
      ['an empty reason', ''],
      ['a reason of spaces', '   '],
      ['a reason over 2000 characters', 'x'.repeat(2001)],
    ])('refuses %s', async (_label, reason) => {
      await expect(
        probe(async (tx) => {
          const { requestId } = await seed(tx);
          await decide(tx, requestId, reason);
        }),
      ).rejects.toThrow(/verification_decisions_reason_present/);
    });

    it('keeps the request a decision was made on', async () => {
      await expect(
        probe(async (tx) => {
          const { requestId } = await seed(tx);
          await decide(tx, requestId, 'Checked.');
          await tx`DELETE FROM verification_requests WHERE id = ${requestId}`;
        }),
      ).rejects.toThrow(/violates foreign key constraint/);
    });
  });
});

/**
 * Every reference restricts. An application, its documents and its decision are the record of
 * how someone came to be verified; none of them may disappear as a side effect of deleting
 * something else. And the reviewer is deliberately not a reference at all.
 */
describe('verification references', () => {
  const refs = (table: PgTable) =>
    getTableConfig(table).foreignKeys.map((f) => ({
      column: f.reference().columns[0]?.name,
      target: f.reference().foreignTable,
      onDelete: f.onDelete,
    }));

  it('a request restricts its profile', () => {
    expect(refs(verificationRequests)).toEqual([
      { column: 'profile_id', target: investigatorProfiles, onDelete: 'restrict' },
    ]);
  });

  it('a document link restricts both its request and its file', () => {
    expect(refs(verificationRequestDocuments)).toEqual(
      expect.arrayContaining([
        { column: 'request_id', target: verificationRequests, onDelete: 'restrict' },
        { column: 'media_asset_id', target: mediaAssets, onDelete: 'restrict' },
      ]),
    );
    expect(refs(verificationRequestDocuments)).toHaveLength(2);
  });

  it('a decision restricts its request, and records its reviewer without a reference', () => {
    // Attribution must survive the reviewer's account, as in audit_logs.
    expect(refs(verificationDecisions)).toEqual([
      { column: 'request_id', target: verificationRequests, onDelete: 'restrict' },
    ]);
  });
});
