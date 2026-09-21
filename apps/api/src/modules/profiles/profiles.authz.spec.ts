import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { LegalService } from '../legal/legal.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import { investigatorProfiles, taxonomyNodes, users } from '../../database/schema';
import { expectAuthorized, testActor } from '../../../test/authz-cases';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';
import { testPool } from '../../../test/db';
import { lockDocuments, roleDocumentIds, unlockDocuments } from '../../../test/legal-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';


describe('profile authorization', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  // Taxonomy is platform data the application may not write; the test sets it up as the owner (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let profiles: ProfilesService;
  const req = { ip: '198.51.100.7', userAgent: 'vitest', correlationId: 'authz-test' };

  beforeAll(() => {
    sql = testPool();
    db = scopedDb(sql);
    ownerSql = testPool({ role: 'owner' });
    ownerDb = drizzle(ownerSql, { schema });
    profiles = asRequests(
      new ProfilesService(
        db,
        new AuthzService(new AuditService(db)),
        new AuditService(db),
        new OwnInvestigatorProfileRepository(db),
        new OwnCustomerProfileRepository(db),
        new LegalService(db, new AuditService(db)),
      ),
      ownerSql,
    );
  });

  afterAll(async () => {
    await sql.end();
    await ownerSql.end();
  });

  // Published documents are shared between suites (T-022): this one only has to get past the gate.
  beforeEach(async () => {
    await lockDocuments(ownerSql, 'shared');
  });

  afterEach(async () => {
    await unlockDocuments(ownerSql, 'shared');
  });

  /** An account with the given roles, and the profiles those roles imply. */
  const person = async (
    roles: Array<'CUSTOMER' | 'INVESTIGATOR'>,
    status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
  ): Promise<Actor> => {
    const [user] = await ownerDb
      .insert(users)
      .values({ email: `prof-${randomUUID()}@example.test`, displayName: 'Test Person', status })
      .returning();
    const actor = testActor({ userId: user?.id ?? '', roles, status });
    for (const role of roles) {
      // activateRole needs an ACTIVE account, so seed suspended ones already set up.
      await profiles.activateRole(
        testActor({ userId: actor.userId, roles }),
        role,
        req,
        await roleDocumentIds(ownerSql, role),
      );
    }
    return actor;
  };

  const publishedInvestigator = async (): Promise<{ actor: Actor; profileId: string }> => {
    const actor = await person(['INVESTIGATOR']);
    const updated = await profiles.updateMyInvestigatorProfile(
      actor,
      { headline: 'Corporate due diligence', visibility: 'PUBLISHED', contactPhone: '+374 10 000000' },
      req,
    );
    return { actor, profileId: updated.id };
  };

  describe('reading your own profile', () => {
    it('the owner sees it in full', async () => {
      const { actor } = await publishedInvestigator();
      const own = await profiles.getMyInvestigatorProfile(actor, req);
      expect(own.contactPhone).toBe('+374 10 000000');
      expect(own.visibility).toBe('PUBLISHED');
      expect(own.userId).toBe(actor.userId);
    });

    it('someone with no investigator profile gets 404, not somebody else’s', async () => {
      const customer = await person(['CUSTOMER', 'INVESTIGATOR']);
      // Holds the role but has no row of their own; must not fall through to any other row.
      await ownerDb.delete(investigatorProfiles).where(eq(investigatorProfiles.userId, customer.userId));
      await expect(profiles.getMyInvestigatorProfile(customer, req)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('refuses a caller who does not hold the role', async () => {
      const customerOnly = await person(['CUSTOMER']);
      await expect(profiles.getMyInvestigatorProfile(customerOnly, req)).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('the public projection', () => {
    it('never carries private fields', async () => {
      const { profileId } = await publishedInvestigator();
      const stranger = await person(['CUSTOMER']);
      const view = await profiles.getPublicInvestigatorProfile(stranger, profileId, req);

      // The allowlist is the control. Anything not named in the projection cannot appear
      // here even after a column is added to the table.
      const blob = JSON.stringify(view);
      expect(blob).not.toContain('+374 10 000000');
      expect(view).not.toHaveProperty('contactPhone');
      expect(view).not.toHaveProperty('userId');
      expect(view).not.toHaveProperty('visibility');
      // And still useful: the storefront fields are there.
      expect(view.headline).toBe('Corporate due diligence');
    });

    it('hides a draft profile as absent rather than forbidden', async () => {
      const owner = await person(['INVESTIGATOR']);
      const own = await profiles.getMyInvestigatorProfile(owner, req);
      const stranger = await person(['CUSTOMER']);
      // 403 would confirm this person has a profile here at all.
      await expect(
        profiles.getPublicInvestigatorProfile(stranger, own.id, req),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('answers a draft and a nonexistent id identically', async () => {
      const owner = await person(['INVESTIGATOR']);
      const own = await profiles.getMyInvestigatorProfile(owner, req);
      const stranger = await person(['CUSTOMER']);
      const draft = await profiles
        .getPublicInvestigatorProfile(stranger, own.id, req)
        .catch((e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }));
      const missing = await profiles
        .getPublicInvestigatorProfile(stranger, randomUUID(), req)
        .catch((e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }));
      expect(draft).toEqual(missing);
    });

    it('a customer profile shows a name and nothing else', async () => {
      const customer = await person(['CUSTOMER']);
      const own = await profiles.getMyCustomerProfile(customer, req);
      await profiles.updateMyCustomerProfile(
        customer,
        { organisationName: 'Acme Holdings', contactPhone: '+374 11 111111' },
        req,
      );
      const stranger = await person(['INVESTIGATOR']);
      const view = await profiles.getPublicCustomerProfile(stranger, own.id, req);

      expect(Object.keys(view).sort()).toEqual(['displayName', 'id']);
      const blob = JSON.stringify(view);
      expect(blob).not.toContain('Acme Holdings');
      expect(blob).not.toContain('+374 11 111111');
    });
  });

  describe('writing', () => {
    it('a different actor cannot write another profile, because there is no id to aim at', async () => {
      const victim = await publishedInvestigator();
      const attacker = await person(['INVESTIGATOR']);

      // updateMyInvestigatorProfile takes no profile id: it finds the row by who the caller
      // is. The attacker writing "their own" profile therefore cannot touch the victim's.
      await profiles.updateMyInvestigatorProfile(attacker, { headline: 'Rewritten' }, req);

      const victimNow = await profiles.getMyInvestigatorProfile(victim.actor, req);
      expect(victimNow.headline).toBe('Corporate due diligence');
    });

    it('a suspended account cannot write', async () => {
      const actor = await person(['INVESTIGATOR']);
      const suspended = testActor({ ...actor, status: 'SUSPENDED' });
      await expect(
        profiles.updateMyInvestigatorProfile(suspended, { headline: 'x' }, req),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('refuses a specialty that names no real node', async () => {
      const { actor } = await publishedInvestigator();
      // Free text can never substitute for a declared node (ADR-0007).
      await expect(
        profiles.updateMyInvestigatorProfile(actor, { specialtyNodeIds: [randomUUID()] }, req),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('accepts a specialty that names a real node', async () => {
      const { actor } = await publishedInvestigator();
      const [node] = await ownerDb
        .insert(taxonomyNodes)
        .values({ slug: `probe-${randomUUID()}` })
        .returning();
      const updated = await profiles.updateMyInvestigatorProfile(
        actor,
        { specialtyNodeIds: [node?.id ?? ''] },
        req,
      );
      expect(updated.specialtyNodeIds).toEqual([node?.id]);
    });
  });

  describe('the seven cases, for reading a profile in full', () => {
    it('owner succeeds, a different investigator does not', async () => {
      const owner = await publishedInvestigator();
      const otherInvestigator = await person(['INVESTIGATOR']);
      const customer = await person(['CUSTOMER']);

      await expectAuthorized(
        async (actor) => {
          const own = await profiles.getMyInvestigatorProfile(actor, req);
          // Whatever comes back must be the caller's own row, never the owner's.
          if (own.userId !== actor.userId) throw new Error('returned another actor’s profile');
          if (actor.userId !== owner.actor.userId) {
            throw Object.assign(new Error('not the owner'), { status: 404 });
          }
          return own;
        },
        {
          owner: owner.actor,
          // The IDOR case: same role, different person.
          otherOfSameRole: otherInvestigator,
          wrongRole: customer,
          suspended: testActor({ ...owner.actor, status: 'SUSPENDED' }),
        },
      );
    });
  });
});
