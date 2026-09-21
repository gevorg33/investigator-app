import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testPool } from '../../../test/db';
import { personalContext, scopedDb } from '../../../test/workspace-context';
import { member } from '../../../test/workspace-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { runInContext } from '../../common/context/execution-context';
import * as schema from '../../database/schema';
import { auditLogs, legalDocuments, userConsents } from '../../database/schema';
import { LegalService } from './legal.service';

/**
 * Recording what someone agreed to (T-021).
 *
 * Every test publishes its own versions of `TERMS_AND_CONDITIONS`, under a type this suite owns,
 * and clears them first — "the current version" is a per-type singleton, so two tests sharing one
 * would be testing each other.
 */
describe('legal consent', () => {
  let app: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let legal: LegalService;

  const TYPE = 'TERMS_AND_CONDITIONS' as const;
  const req = () => ({ ip: '198.51.100.11', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    app = testPool({ max: 2 });
    ownerSql = testPool({ max: 2, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const db = scopedDb(app);
    legal = new LegalService(db, new AuditService(db));
  });

  afterAll(async () => {
    await app.end();
    await ownerSql.end();
  });

  beforeEach(async () => {
    // Consents reference documents, so they go first.
    await ownerSql`
      DELETE FROM user_consents WHERE legal_document_id IN
        (SELECT id FROM legal_documents WHERE type = ${TYPE})`;
    await ownerSql`DELETE FROM legal_documents WHERE type = ${TYPE}`;
  });

  /** A published version of this suite's document type. */
  const publish = async (
    over: {
      version?: number;
      locale?: string;
      content?: string;
      authoritative?: boolean;
      requiresReacceptance?: boolean;
      status?: 'DRAFT' | 'CURRENT' | 'SUPERSEDED';
    } = {},
  ) => {
    const status = over.status ?? 'CURRENT';
    const [row] = await ownerDb
      .insert(legalDocuments)
      .values({
        type: TYPE,
        version: over.version ?? 1,
        locale: over.locale ?? 'en',
        title: 'Terms and conditions',
        content: over.content ?? `Draft text ${randomUUID()}`,
        // Replaced by the database; supplied because the column is NOT NULL.
        contentHash: 'computed-by-the-database',
        status,
        isAuthoritativeLocale: over.authoritative ?? true,
        requiresReacceptance: over.requiresReacceptance ?? true,
        ...(status === 'DRAFT' ? {} : { publishedAt: new Date(), effectiveFrom: new Date() }),
      })
      .returning();
    return row!;
  };

  const user = async () => (await member(ownerSql)).actor.userId;

  const consentsOf = (userId: string) =>
    ownerDb
      .select()
      .from(userConsents)
      .where(and(eq(userConsents.userId, userId), eq(userConsents.documentType, TYPE)));

  describe('reading what is in force', () => {
    it('returns the current version, with the text and the hash a record would copy', async () => {
      const published = await publish({ content: 'You agree to behave lawfully.' });
      const current = await legal.currentDocument(TYPE);
      expect(current).toMatchObject({
        id: published.id,
        version: 1,
        locale: 'en',
        content: 'You agree to behave lawfully.',
        contentHash: published.contentHash,
        authoritative: true,
      });
    });

    it('gives the reader their own language where that translation exists', async () => {
      await publish({ locale: 'en', content: 'English text.' });
      await publish({ locale: 'hy', content: 'Հայերեն տեքստ։', authoritative: false });
      expect(await legal.currentDocument(TYPE, 'hy')).toMatchObject({
        locale: 'hy',
        content: 'Հայերեն տեքստ։',
        authoritative: false,
      });
    });

    it('falls back to the authoritative locale rather than showing nothing', async () => {
      await publish({ locale: 'en', content: 'English text.' });
      expect(await legal.currentDocument(TYPE, 'ru')).toMatchObject({
        locale: 'en',
        authoritative: true,
      });
    });

    it('refuses when nothing is published, because no terms is not agreed terms', async () => {
      await expect(legal.currentDocument(TYPE)).rejects.toMatchObject({ status: 404 });
    });

    it('does not offer a draft as the current version', async () => {
      await publish({ status: 'DRAFT' });
      await expect(legal.currentDocument(TYPE)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('recording an acceptance', () => {
    it('copies the document’s type, version, hash and locale onto the row', async () => {
      const document = await publish({ content: 'Exactly this text.' });
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req());

      const [row] = await consentsOf(userId);
      expect(row).toMatchObject({
        legalDocumentId: document.id,
        documentType: TYPE,
        documentVersion: 1,
        contentHash: document.contentHash,
        localeShown: 'en',
        action: 'ACCEPTED',
        context: 'REGISTRATION',
      });
    });

    it('records where the request came from, so the row stands as evidence', async () => {
      const document = await publish();
      const userId = await user();
      const r = req();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, r);

      const [row] = await consentsOf(userId);
      expect(row).toMatchObject({
        ipAddress: r.ip,
        userAgent: r.userAgent,
        correlationId: r.correlationId,
      });
    });

    it('records the workspace it was given in, when it was given in one', async () => {
      const document = await publish();
      const person = await member(ownerSql);
      const context = await personalContext(ownerSql, person.actor.userId);
      await runInContext(context, () =>
        legal.accept(
          { userId: person.actor.userId, documentId: document.id, context: 'AGENCY_CREATION' },
          req(),
        ),
      );
      const [row] = await consentsOf(person.actor.userId);
      expect(row?.tenantId).toBe(context.tenantId);
    });

    it('records no workspace for an acceptance given before one exists', async () => {
      const document = await publish();
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req());
      expect((await consentsOf(userId))[0]?.tenantId).toBeNull();
    });

    it('audits it, separately from the consent row itself', async () => {
      // Two stores, two purposes: one is the evidence, the other is the trail.
      const document = await publish();
      const userId = await user();
      const r = req();
      await legal.accept({ userId, documentId: document.id, context: 'ROLE_ACTIVATION' }, r);

      const [entry] = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, r.correlationId));
      expect(entry).toMatchObject({
        actorId: userId,
        action: 'legal.consent.accepted',
        resourceType: 'legal_document',
        resourceId: document.id,
      });
    });

    it('commits with the work it belongs to, or not at all', async () => {
      // An account without its consent rows must not exist, so the caller hands in the
      // transaction the account is being created in — and a failure takes both.
      const document = await publish();
      const userId = await user();
      const db = scopedDb(app);
      await expect(
        db.transaction(async (tx) => {
          await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req(), tx);
          throw new Error('the registration failed after the consent was recorded');
        }),
      ).rejects.toThrow('the registration failed');
      expect(await consentsOf(userId)).toEqual([]);
    });

    it('records what it has, when the request tells it nothing about where it came from', async () => {
      // A job or an internal call has no IP and no user agent. The consent is still the fact.
      const document = await publish();
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, {});
      expect((await consentsOf(userId))[0]).toMatchObject({
        ipAddress: null,
        userAgent: null,
        correlationId: null,
        action: 'ACCEPTED',
      });
    });

    it('refuses a document that does not exist', async () => {
      await expect(
        legal.accept(
          { userId: await user(), documentId: randomUUID(), context: 'REGISTRATION' },
          req(),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('withdrawing', () => {
    it('appends: the acceptance that happened stays on the record', async () => {
      const document = await publish();
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req());
      await legal.withdraw({ userId, documentId: document.id, context: 'REACCEPTANCE' }, req());

      const rows = await consentsOf(userId);
      expect(rows.map((r) => r.action).sort()).toEqual(['ACCEPTED', 'WITHDRAWN']);
    });

    it('audits the withdrawal as its own event', async () => {
      const document = await publish();
      const userId = await user();
      const r = req();
      await legal.withdraw({ userId, documentId: document.id, context: 'REACCEPTANCE' }, r);
      const [entry] = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.correlationId, r.correlationId));
      expect(entry?.action).toBe('legal.consent.withdrawn');
    });
  });

  describe('whether the product may proceed', () => {
    it('is not satisfied by someone who never accepted', async () => {
      await publish();
      expect(await legal.consentState(await user(), TYPE)).toMatchObject({
        acceptedVersion: null,
        currentVersion: 1,
        satisfied: false,
      });
    });

    it('is satisfied by acceptance of the current version', async () => {
      const document = await publish();
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req());
      expect(await legal.consentState(userId, TYPE)).toMatchObject({
        acceptedVersion: 1,
        satisfied: true,
      });
    });

    it('is not satisfied once a material version supersedes what they accepted', async () => {
      const first = await publish({ version: 1 });
      const userId = await user();
      await legal.accept({ userId, documentId: first.id, context: 'REGISTRATION' }, req());

      await ownerDb
        .update(legalDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(eq(legalDocuments.id, first.id));
      await publish({ version: 2, requiresReacceptance: true });

      expect(await legal.consentState(userId, TYPE)).toMatchObject({
        acceptedVersion: 1,
        currentVersion: 2,
        satisfied: false,
      });
    });

    it('stays satisfied when the newer version is not material', async () => {
      // A typo does not oblige anybody to agree again. Whether it is a typo is compliance's
      // call, set on the document, read here.
      const first = await publish({ version: 1 });
      const userId = await user();
      await legal.accept({ userId, documentId: first.id, context: 'REGISTRATION' }, req());

      await ownerDb
        .update(legalDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(eq(legalDocuments.id, first.id));
      await publish({ version: 2, requiresReacceptance: false });

      expect(await legal.consentState(userId, TYPE)).toMatchObject({
        acceptedVersion: 1,
        currentVersion: 2,
        satisfied: true,
      });
    });

    it('is not satisfied when a material version sits between theirs and the current one', async () => {
      // Every version since theirs is asked, not just the newest: a material change does not
      // stop being material because a typo was fixed after it.
      const first = await publish({ version: 1 });
      const userId = await user();
      await legal.accept({ userId, documentId: first.id, context: 'REGISTRATION' }, req());

      await ownerDb
        .update(legalDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(eq(legalDocuments.id, first.id));
      const second = await publish({ version: 2, requiresReacceptance: true });
      await ownerDb
        .update(legalDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(eq(legalDocuments.id, second.id));
      await publish({ version: 3, requiresReacceptance: false });

      expect(await legal.consentState(userId, TYPE)).toMatchObject({
        acceptedVersion: 1,
        currentVersion: 3,
        satisfied: false,
      });
    });

    it('is not satisfied after a withdrawal, whatever came before it', async () => {
      const document = await publish();
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req());
      await legal.withdraw({ userId, documentId: document.id, context: 'REACCEPTANCE' }, req());
      expect(await legal.consentState(userId, TYPE)).toMatchObject({ satisfied: false });
    });

    it('is satisfied again when they accept after withdrawing', async () => {
      const document = await publish();
      const userId = await user();
      await legal.accept({ userId, documentId: document.id, context: 'REGISTRATION' }, req());
      await legal.withdraw({ userId, documentId: document.id, context: 'REACCEPTANCE' }, req());
      await legal.accept({ userId, documentId: document.id, context: 'REACCEPTANCE' }, req());
      expect(await legal.consentState(userId, TYPE)).toMatchObject({
        acceptedVersion: 1,
        satisfied: true,
      });
    });
  });
});
