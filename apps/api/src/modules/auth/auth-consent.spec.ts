import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testActor } from '../../../test/authz-cases';
import { testPool } from '../../../test/db';
import { lockDocuments, roleDocumentIds, unlockDocuments } from '../../../test/legal-fixtures';
import { personalContext, scopedDb } from '../../../test/workspace-context';
import { AuditService } from '../../common/audit/audit.service';
import { runInContext } from '../../common/context/execution-context';
import { AuthzService } from '../../common/authz/authz.service';
import * as schema from '../../database/schema';
import { legalDocuments, userConsents, userRoles, users } from '../../database/schema';
import { LegalService } from '../legal/legal.service';
import { REQUIRED_AT_REGISTRATION, requiredForRole } from '../legal/legal.policy';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from '../profiles/profiles.repository';
import { ProfilesService } from '../profiles/profiles.service';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { MemoryRateLimitStore, RateLimitService } from './rate-limit.service';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import { TokenService } from './token.service';
import { UserTokenService } from './user-token.service';

/**
 * The acceptance gate (T-022, `legal-consent`).
 *
 * Registration cannot complete without accepting what registration requires, and an investigator
 * accepts what an investigator is bound by when the role is activated — they were not one when
 * they signed up. Both are enforced **in the service**, because a hostile client posts straight
 * to the endpoint, and both write the account or the role and the consent rows in **one
 * transaction**: an account that exists having agreed to nothing must not be reachable.
 *
 * Every test publishes the documents it needs and clears them first. The gate is global and the
 * development database is shared, so a suite that left one published would be deciding another
 * suite's outcome.
 */
describe('the acceptance gate', () => {
  let sql: postgres.Sql;
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let auth: AuthService;
  let profiles: ProfilesService;
  let legal: LegalService;

  // A fresh address per call: the per-IP registration limit is real, and this suite registers
  // many accounts. What the limit does is rate-limit.service.spec.ts's subject.
  const ctx = () => ({
    ip: `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    userAgent: 'vitest',
    correlationId: randomUUID(),
  });
  const PASSWORD = 'a-sufficiently-long-password';
  const email = () => `consent-${randomUUID()}@example.test`;

  const ALL_TYPES = [
    ...REQUIRED_AT_REGISTRATION,
    ...requiredForRole('CUSTOMER'),
    ...requiredForRole('INVESTIGATOR'),
  ];

  beforeAll(() => {
    sql = testPool({ max: 3 });
    ownerSql = testPool({ max: 3, role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    const db = scopedDb(sql);
    const audit = new AuditService(db);
    const tokens = new TokenService();
    legal = new LegalService(db, audit);
    auth = new AuthService(
      db,
      new PasswordService(),
      tokens,
      new SessionService(tokens),
      new RateLimitService(new MemoryRateLimitStore()),
      audit,
      new UserTokenService(tokens),
      { send: async () => undefined },
      new SessionRepository(db),
      new AuthzService(audit),
      legal,
    );
    profiles = new ProfilesService(
      db,
      new AuthzService(audit),
      audit,
      new OwnInvestigatorProfileRepository(db),
      new OwnCustomerProfileRepository(db),
      legal,
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  // Published documents are shared between suites (T-022): this one changes them.
  beforeEach(async () => {
    await lockDocuments(ownerSql, 'exclusive');
  });

  afterEach(async () => {
    // Cleared before the lock is released: outside this suite's tests nothing is published, so
    // no other suite's registration is decided by what this one was doing.
    await clear();
    await unlockDocuments(ownerSql, 'exclusive');
  });

  const clear = async () => {
    await ownerSql`
      DELETE FROM user_consents WHERE legal_document_id IN
        (SELECT id FROM legal_documents WHERE type = ANY(${[...ALL_TYPES]}::legal_document_type[]))`;
    await ownerSql`
      DELETE FROM legal_documents
       WHERE type = ANY(${[...ALL_TYPES]}::legal_document_type[])`;
  };

  beforeEach(clear);

  const publish = async (type: (typeof ALL_TYPES)[number], version = 1, material = true) => {
    const [row] = await ownerDb
      .insert(legalDocuments)
      .values({
        type,
        version,
        locale: 'en',
        title: type,
        content: `${type} v${version} ${randomUUID()}`,
        contentHash: 'computed-by-the-database',
        status: 'CURRENT',
        isAuthoritativeLocale: true,
        requiresReacceptance: material,
        publishedAt: new Date(),
        effectiveFrom: new Date(),
      })
      .returning();
    return row!;
  };

  const userByEmail = async (address: string) =>
    (await ownerDb.select().from(users).where(eq(users.email, address)))[0];

  const consentsOf = (userId: string) =>
    ownerDb.select().from(userConsents).where(eq(userConsents.userId, userId));

  /**
   * Activating a role writes a profile, which belongs to a workspace — so it runs in the
   * caller's Personal one, the way a request does (T-077).
   */
  const activate = async (
    actor: { userId: string },
    role: 'CUSTOMER' | 'INVESTIGATOR',
    acceptedDocumentIds: string[],
  ) => {
    const context = await personalContext(ownerSql, actor.userId);
    return runInContext(context, () =>
      profiles.activateRole(actor as never, role, ctx(), acceptedDocumentIds),
    );
  };

  describe('registration', () => {
    it('is refused without acceptance, and leaves no account behind', async () => {
      // The check a hostile client meets: posting straight to the endpoint with nothing accepted.
      await publish('PRIVACY_POLICY');
      await publish('TERMS_OF_SERVICE');
      const address = email();

      await expect(auth.register(address, PASSWORD, ctx(), [])).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await userByEmail(address)).toBeUndefined();
    });

    it('names every document still missing, so the client can act on it', async () => {
      const privacy = await publish('PRIVACY_POLICY');
      await publish('TERMS_OF_SERVICE');

      const refusal = await auth
        .register(email(), PASSWORD, ctx(), [privacy.id])
        .catch((e: unknown) => e as { details?: Array<{ messageKey: string }> });

      expect(refusal.details?.map((d) => d.messageKey)).toEqual([
        'error.validation.legal.terms_of_service',
      ]);
    });

    it('completes when everything required is accepted, and records each one', async () => {
      const privacy = await publish('PRIVACY_POLICY');
      const terms = await publish('TERMS_OF_SERVICE');
      const address = email();

      await auth.register(address, PASSWORD, ctx(), [privacy.id, terms.id]);

      const user = await userByEmail(address);
      expect(user).toBeDefined();
      const rows = await consentsOf(user!.id);
      expect(rows.map((r) => r.documentType).sort()).toEqual([
        'PRIVACY_POLICY',
        'TERMS_OF_SERVICE',
      ]);
      expect(rows.every((r) => r.action === 'ACCEPTED' && r.context === 'REGISTRATION')).toBe(true);
      // The exact text shown is retrievable from any of these rows.
      expect(rows.map((r) => r.contentHash).sort()).toEqual(
        [privacy.contentHash, terms.contentHash].sort(),
      );
    });

    it('works as it always did while nothing is published', async () => {
      // Owner decision, 2026-09-21: what is required is what is in force. With no text there is
      // nothing to agree to, and refusing everybody would be a gate on the wrong thing.
      const address = email();
      await auth.register(address, PASSWORD, ctx(), []);
      const user = await userByEmail(address);
      expect(user).toBeDefined();
      expect(await consentsOf(user!.id)).toEqual([]);
    });

    it('requires only what is published, not the whole list', async () => {
      const privacy = await publish('PRIVACY_POLICY');
      const address = email();
      await auth.register(address, PASSWORD, ctx(), [privacy.id]);
      const user = await userByEmail(address);
      expect((await consentsOf(user!.id)).map((r) => r.documentType)).toEqual(['PRIVACY_POLICY']);
    });

    it('refuses a superseded version, so an old text cannot satisfy the gate', async () => {
      const first = await publish('PRIVACY_POLICY', 1);
      await ownerDb
        .update(legalDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(eq(legalDocuments.id, first.id));
      await publish('PRIVACY_POLICY', 2);

      await expect(auth.register(email(), PASSWORD, ctx(), [first.id])).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });
  });

  describe('role activation', () => {
    const registered = async () => {
      const address = email();
      await auth.register(address, PASSWORD, ctx(), await currentIds(REQUIRED_AT_REGISTRATION));
      const user = await userByEmail(address);
      return testActor({ userId: user!.id, roles: [] });
    };

    const currentIds = async (types: readonly (typeof ALL_TYPES)[number][]) => {
      const rows = await ownerDb
        .select()
        .from(legalDocuments)
        .where(eq(legalDocuments.status, 'CURRENT'));
      return rows.filter((r) => types.includes(r.type)).map((r) => r.id);
    };

    it('refuses an investigator who has not accepted what an investigator agrees to', async () => {
      await publish('INVESTIGATOR_AGREEMENT');
      await publish('LAWFUL_USE_POLICY');
      const actor = await registered();

      await expect(activate(actor, 'INVESTIGATOR', [])).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });

      expect(
        await ownerDb.select().from(userRoles).where(eq(userRoles.userId, actor.userId)),
      ).toEqual([]);
    });

    it('activates once they have, recording it as a role activation', async () => {
      await publish('INVESTIGATOR_AGREEMENT');
      await publish('LAWFUL_USE_POLICY');
      const actor = await registered();

      await activate(actor, 'INVESTIGATOR', await roleDocumentIds(ownerSql, 'INVESTIGATOR'));

      const [role] = await ownerDb
        .select()
        .from(userRoles)
        .where(and(eq(userRoles.userId, actor.userId), eq(userRoles.role, 'INVESTIGATOR')));
      expect(role).toBeDefined();
      const rows = await consentsOf(actor.userId);
      expect(
        rows
          .filter((r) => r.context === 'ROLE_ACTIVATION')
          .map((r) => r.documentType)
          .sort(),
      ).toEqual(['INVESTIGATOR_AGREEMENT', 'LAWFUL_USE_POLICY']);
    });

    it('does not ask an investigator to accept the same thing twice', async () => {
      await publish('INVESTIGATOR_AGREEMENT');
      const actor = await registered();
      const ids = await roleDocumentIds(ownerSql, 'INVESTIGATOR');
      await activate(actor, 'INVESTIGATOR', ids);
      await activate(actor, 'INVESTIGATOR', []);

      expect(
        (await consentsOf(actor.userId)).filter((r) => r.documentType === 'INVESTIGATOR_AGREEMENT'),
      ).toHaveLength(1);
    });

    it('asks a customer only for what a customer is bound by', async () => {
      await publish('TERMS_AND_CONDITIONS');
      await publish('INVESTIGATOR_AGREEMENT');
      const actor = await registered();

      await activate(actor, 'CUSTOMER', await roleDocumentIds(ownerSql, 'CUSTOMER'));

      expect(
        (await consentsOf(actor.userId))
          .map((r) => r.documentType)
          .includes('INVESTIGATOR_AGREEMENT'),
      ).toBe(false);
    });
  });

  describe('when a new version publishes', () => {
    const accepted = async () => {
      const address = email();
      const privacy = await publish('PRIVACY_POLICY', 1);
      await auth.register(address, PASSWORD, ctx(), [privacy.id]);
      const user = await userByEmail(address);
      return { userId: user!.id, first: privacy };
    };

    const supersede = async (previous: { id: string }, material: boolean) => {
      await ownerDb
        .update(legalDocuments)
        .set({ status: 'SUPERSEDED' })
        .where(eq(legalDocuments.id, previous.id));
      return publish('PRIVACY_POLICY', 2, material);
    };

    it('is outstanding again when the change is material', async () => {
      const { userId, first } = await accepted();
      expect(await legal.outstanding(userId, ['PRIVACY_POLICY'])).toEqual([]);

      await supersede(first, true);

      expect((await legal.outstanding(userId, ['PRIVACY_POLICY'])).map((d) => d.version)).toEqual([
        2,
      ]);
    });

    it('is not outstanding when the change is not material', async () => {
      // A typo does not oblige anybody to agree again. Whether it is a typo is compliance's call.
      const { userId, first } = await accepted();
      await supersede(first, false);
      expect(await legal.outstanding(userId, ['PRIVACY_POLICY'])).toEqual([]);
    });

    it('is cleared by accepting the new version, as a re-acceptance', async () => {
      const { userId, first } = await accepted();
      const second = await supersede(first, true);

      await legal.requireAcceptance(
        {
          userId,
          types: ['PRIVACY_POLICY'],
          acceptedDocumentIds: [second.id],
          context: 'REACCEPTANCE',
        },
        ctx(),
      );

      expect(await legal.outstanding(userId, ['PRIVACY_POLICY'])).toEqual([]);
      const rows = await consentsOf(userId);
      expect(rows.filter((r) => r.context === 'REACCEPTANCE')).toHaveLength(1);
      // Both acceptances stand on the record: the first one still happened.
      expect(rows.filter((r) => r.documentType === 'PRIVACY_POLICY')).toHaveLength(2);
    });
  });
});
