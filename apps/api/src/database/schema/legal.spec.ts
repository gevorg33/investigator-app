import { createHash, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { testPool } from '../../../test/db';
import { legalDocuments, userConsents } from './legal';

/**
 * The rules a consent record depends on, held by the database rather than by whoever writes
 * (T-021, `legal-consent`). Every probe runs in a transaction that is rolled back.
 */
class RollbackSignal extends Error {}

describe('legal documents and consent records', () => {
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

  /** A published version, of a type nothing else in the suite publishes. */
  const publish = async (
    tx: postgres.TransactionSql,
    over: {
      version?: number;
      locale?: string;
      content?: string;
      authoritative?: boolean;
      status?: 'DRAFT' | 'CURRENT' | 'SUPERSEDED';
    } = {},
  ) => {
    const status = over.status ?? 'CURRENT';
    const [row] = await tx<{ id: string; content_hash: string }[]>`
      INSERT INTO legal_documents (type, version, locale, title, content, status,
                                   is_authoritative_locale, published_at, effective_from)
      VALUES ('LAWFUL_USE_POLICY', ${over.version ?? 1}, ${over.locale ?? 'en'}, 'Probe',
              ${over.content ?? 'Investigations must be lawful.'}, ${status}::legal_document_status,
              ${over.authoritative ?? true},
              ${status === 'DRAFT' ? null : new Date()}, ${status === 'DRAFT' ? null : new Date()})
      RETURNING id, content_hash`;
    return row!;
  };

  const person = async (tx: postgres.TransactionSql) => {
    const [user] = await tx<{ id: string }[]>`
      INSERT INTO users (email) VALUES (${`legal-${randomUUID()}@example.test`}) RETURNING id`;
    return user!.id;
  };

  const consent = (
    tx: postgres.TransactionSql,
    userId: string,
    document: { id: string; content_hash: string },
    over: { type?: string; version?: number; hash?: string; locale?: string } = {},
  ) => tx`
      INSERT INTO user_consents (user_id, legal_document_id, document_type, document_version,
                                 content_hash, locale_shown, action, context)
      VALUES (${userId}, ${document.id}, ${over.type ?? 'LAWFUL_USE_POLICY'}::legal_document_type,
              ${over.version ?? 1}, ${over.hash ?? document.content_hash},
              ${over.locale ?? 'en'}, 'ACCEPTED', 'REGISTRATION')`;

  describe('a document', () => {
    it('is hashed by the database, from the text itself', async () => {
      const content = `Investigations must be lawful. ${randomUUID()}`;
      const stored = await probe((tx) => publish(tx, { content }));
      expect(stored.content_hash).toBe(createHash('sha256').update(content).digest('hex'));
    });

    it('cannot be handed a hash by whoever writes it', async () => {
      // The hash is computed on write, so a supplied one is simply replaced: a record whose
      // hash its writer chose proves nothing about the text.
      const content = `Chosen hash attempt ${randomUUID()}`;
      const stored = await probe(async (tx) => {
        const [row] = await tx<{ content_hash: string }[]>`
          INSERT INTO legal_documents (type, version, locale, title, content, content_hash,
                                       status, published_at, effective_from)
          VALUES ('LAWFUL_USE_POLICY', 7, 'en', 'Probe', ${content}, 'not-a-real-hash',
                  'CURRENT', now(), now())
          RETURNING content_hash`;
        return row!;
      });
      expect(stored.content_hash).toBe(createHash('sha256').update(content).digest('hex'));
    });

    it('refuses to change once published — a correction is a new version', async () => {
      await expect(
        probe(async (tx) => {
          const doc = await publish(tx);
          await tx`UPDATE legal_documents SET content = 'Quietly different.' WHERE id = ${doc.id}`;
        }),
      ).rejects.toThrow(/legal_documents_published_immutable/);
    });

    it('still lets a published version be superseded', async () => {
      // The status is the one thing that may move on; everything else about it is settled.
      await expect(
        probe(async (tx) => {
          const doc = await publish(tx);
          await tx`UPDATE legal_documents SET status = 'SUPERSEDED' WHERE id = ${doc.id}`;
        }),
      ).resolves.toBeUndefined();
    });

    it('lets a draft be edited, because nobody can have agreed to it yet', async () => {
      const stored = await probe(async (tx) => {
        const doc = await publish(tx, { status: 'DRAFT' });
        const [row] = await tx<{ content_hash: string }[]>`
          UPDATE legal_documents SET content = 'Reworded draft.' WHERE id = ${doc.id}
          RETURNING content_hash`;
        return row!;
      });
      expect(stored.content_hash).toBe(
        createHash('sha256').update('Reworded draft.').digest('hex'),
      );
    });

    it('allows one current version per type and locale', async () => {
      await expect(
        probe(async (tx) => {
          await publish(tx, { version: 1 });
          await publish(tx, { version: 2, authoritative: false });
        }),
      ).rejects.toThrow(/legal_documents_one_current/);
    });

    it('allows one authoritative locale per version', async () => {
      await expect(
        probe(async (tx) => {
          await publish(tx, { locale: 'en' });
          await publish(tx, { locale: 'hy', status: 'SUPERSEDED', authoritative: true });
        }),
      ).rejects.toThrow(/legal_documents_one_authoritative/);
    });

    it('refuses a published version with no dates', async () => {
      await expect(
        probe(
          (tx) => tx`
            INSERT INTO legal_documents (type, version, locale, title, content, status)
            VALUES ('LAWFUL_USE_POLICY', 3, 'en', 'Probe', 'Undated.', 'CURRENT')`,
        ),
      ).rejects.toThrow(/legal_documents_published_is_dated/);
    });
  });

  describe('a consent record', () => {
    it('must agree with the document it names', async () => {
      // The copy is the evidence, so a copy that does not match the document is a forgery,
      // whether by malice or by a caller assembling the row by hand.
      await expect(
        probe(async (tx) => {
          const doc = await publish(tx);
          await consent(tx, await person(tx), doc, { hash: 'a-different-hash' });
        }),
      ).rejects.toThrow(/user_consents_matches_document/);
    });

    it.each([
      ['a version that is not the document’s', { version: 9 }],
      ['a locale that is not the document’s', { locale: 'hy' }],
      ['a type that is not the document’s', { type: 'TERMS_OF_SERVICE' }],
    ])('refuses %s', async (_label, over) => {
      await expect(
        probe(async (tx) => {
          const doc = await publish(tx);
          await consent(tx, await person(tx), doc, over);
        }),
      ).rejects.toThrow(/user_consents_matches_document/);
    });

    it('refuses to record agreement to an unpublished draft', async () => {
      await expect(
        probe(async (tx) => {
          const doc = await publish(tx, { status: 'DRAFT' });
          await consent(tx, await person(tx), doc);
        }),
      ).rejects.toThrow(/user_consents_document_published/);
    });

    it('outlives the account that gave it', async () => {
      // Deleting a user does not delete the proof that they agreed to the terms their data was
      // processed under — which is often exactly what a regulator asks for.
      const remaining = await probe(async (tx) => {
        const doc = await publish(tx);
        const userId = await person(tx);
        await consent(tx, userId, doc);
        await tx`DELETE FROM users WHERE id = ${userId}`;
        const [row] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM user_consents WHERE user_id = ${userId}`;
        return row!.n;
      });
      expect(remaining).toBe(1);
    });

    it('holds the document it names, so evidence cannot be deleted out from under it', async () => {
      await expect(
        probe(async (tx) => {
          const doc = await publish(tx);
          await consent(tx, await person(tx), doc);
          await tx`DELETE FROM legal_documents WHERE id = ${doc.id}`;
        }),
      ).rejects.toThrow(/violates foreign key constraint/);
    });
  });

  describe('what the application may do', () => {
    it('reads documents and never writes them', async () => {
      const granted = await owner<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'investigator_app' AND table_name = 'legal_documents'
         ORDER BY 1`;
      expect(granted.map((g) => g.privilege_type)).toEqual(['SELECT']);
    });

    it('appends consents and can never rewrite one', async () => {
      const granted = await owner<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
         WHERE grantee = 'investigator_app' AND table_name = 'user_consents'
         ORDER BY 1`;
      expect(granted.map((g) => g.privilege_type)).toEqual(['INSERT', 'SELECT']);
    });
  });

  describe('what the consent points at', () => {
    it('names the document, and cannot outlive it', () => {
      // RESTRICT, not CASCADE: deleting the text someone agreed to would leave a record that
      // proves nothing. The reference is resolved here, which is also what exercises it.
      const [reference] = getTableConfig(userConsents).foreignKeys.map((f) => ({
        columns: f.reference().columns.map((c) => c.name),
        target: f.reference().foreignTable,
        onDelete: f.onDelete,
      }));
      expect(reference).toEqual({
        columns: ['legal_document_id'],
        target: legalDocuments,
        onDelete: 'restrict',
      });
    });
  });
});
