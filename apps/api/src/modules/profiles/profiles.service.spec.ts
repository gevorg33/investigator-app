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
import { investigatorAvailability, investigatorLanguages, taxonomyNodes, users } from '../../database/schema';
import { testActor } from '../../../test/authz-cases';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';
import { testPool } from '../../../test/db';
import { lockDocuments, roleDocumentIds, unlockDocuments } from '../../../test/legal-fixtures';
import { asRequests, scopedDb } from '../../../test/workspace-context';


describe('profile persistence', () => {
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  // Taxonomy is platform data the application may not write; the test sets it up as the owner (T-073).
  let ownerSql: postgres.Sql;
  let ownerDb: ReturnType<typeof drizzle<typeof schema>>;
  let profiles: ProfilesService;
  const req = { ip: '198.51.100.11', userAgent: 'vitest', correlationId: 'persist-test' };

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

  const investigator = async (): Promise<Actor> => {
    const [user] = await ownerDb
      .insert(users)
      .values({ email: `persist-${randomUUID()}@example.test`, displayName: 'Nairi' })
      .returning();
    const actor = testActor({ userId: user?.id ?? '', roles: ['INVESTIGATOR'] });
    await profiles.activateRole(actor, 'INVESTIGATOR', req, await roleDocumentIds(ownerSql, 'INVESTIGATOR'));
    return actor;
  };

  const node = async (): Promise<string> => {
    const [n] = await ownerDb.insert(taxonomyNodes).values({ slug: `n-${randomUUID()}` }).returning();
    return n?.id ?? '';
  };

  it('round-trips every field', async () => {
    const actor = await investigator();
    const [a, b] = [await node(), await node()];

    const saved = await profiles.updateMyInvestigatorProfile(
      actor,
      {
        headline: 'Corporate due diligence',
        bio: 'Fifteen years of it.',
        yearsExperience: 15,
        pricingModel: 'HOURLY',
        hourlyRateMinor: 7500,
        currency: 'AMD',
        acceptingWork: true,
        visibility: 'PUBLISHED',
        contactPhone: '+374 10 123456',
        languages: [
          { languageCode: 'hy', proficiency: 'NATIVE' },
          { languageCode: 'ru', proficiency: 'FLUENT' },
        ],
        specialtyNodeIds: [a, b],
        availability: [{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }],
      },
      req,
    );

    expect(saved).toMatchObject({
      headline: 'Corporate due diligence',
      bio: 'Fifteen years of it.',
      yearsExperience: 15,
      pricingModel: 'HOURLY',
      hourlyRateMinor: 7500,
      currency: 'AMD',
      acceptingWork: true,
      visibility: 'PUBLISHED',
      contactPhone: '+374 10 123456',
      displayName: 'Nairi',
    });
    expect(saved.languages).toHaveLength(2);
    expect([...saved.specialtyNodeIds].sort()).toEqual([a, b].sort());
    expect(saved.availability).toEqual([{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }]);
  });

  it('leaves untouched fields alone when the update names none of them', async () => {
    const actor = await investigator();
    await profiles.updateMyInvestigatorProfile(actor, { headline: 'Kept' }, req);
    // An empty patch must not blank the profile — the absent side of every optional field.
    const after = await profiles.updateMyInvestigatorProfile(actor, {}, req);
    expect(after.headline).toBe('Kept');
  });

  it('replaces rather than merges a set, so removal is expressible', async () => {
    const actor = await investigator();
    await profiles.updateMyInvestigatorProfile(
      actor,
      { languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }] },
      req,
    );
    const after = await profiles.updateMyInvestigatorProfile(
      actor,
      { languages: [{ languageCode: 'ru', proficiency: 'BASIC' }] },
      req,
    );
    expect(after.languages).toEqual([{ languageCode: 'ru', proficiency: 'BASIC' }]);
  });

  it('clears a set when given an empty array', async () => {
    const actor = await investigator();
    const n = await node();
    await profiles.updateMyInvestigatorProfile(
      actor,
      {
        languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
        specialtyNodeIds: [n],
        availability: [{ dayOfWeek: 0, startMinute: 60, endMinute: 120 }],
      },
      req,
    );
    const cleared = await profiles.updateMyInvestigatorProfile(
      actor,
      { languages: [], specialtyNodeIds: [], availability: [] },
      req,
    );
    expect(cleared.languages).toEqual([]);
    expect(cleared.specialtyNodeIds).toEqual([]);
    expect(cleared.availability).toEqual([]);
  });

  it('leaves no orphan rows behind when a set is replaced', async () => {
    const actor = await investigator();
    const own = await profiles.updateMyInvestigatorProfile(
      actor,
      {
        languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
        availability: [{ dayOfWeek: 2, startMinute: 60, endMinute: 120 }],
      },
      req,
    );
    await profiles.updateMyInvestigatorProfile(actor, { languages: [], availability: [] }, req);

    const langs = await ownerDb
      .select()
      .from(investigatorLanguages)
      .where(eq(investigatorLanguages.profileId, own.id));
    const avail = await ownerDb
      .select()
      .from(investigatorAvailability)
      .where(eq(investigatorAvailability.profileId, own.id));
    expect([langs.length, avail.length]).toEqual([0, 0]);
  });

  it('rejects the whole update when one specialty is unknown', async () => {
    const actor = await investigator();
    const good = await node();
    await expect(
      profiles.updateMyInvestigatorProfile(
        actor,
        { headline: 'Should not persist', specialtyNodeIds: [good, randomUUID()] },
        req,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    // Checked before the transaction, so nothing in the update was applied.
    const after = await profiles.getMyInvestigatorProfile(actor, req);
    expect(after.headline).not.toBe('Should not persist');
    expect(after.specialtyNodeIds).toEqual([]);
  });

  describe('customer profile', () => {
    const customer = async (): Promise<Actor> => {
      const [user] = await ownerDb
        .insert(users)
        .values({ email: `cust-${randomUUID()}@example.test`, displayName: 'Ani' })
        .returning();
      const actor = testActor({ userId: user?.id ?? '', roles: ['CUSTOMER'] });
      await profiles.activateRole(actor, 'CUSTOMER', req, await roleDocumentIds(ownerSql, 'CUSTOMER'));
      return actor;
    };

    it('round-trips its fields', async () => {
      const actor = await customer();
      const saved = await profiles.updateMyCustomerProfile(
        actor,
        { organisationName: 'Acme Holdings', contactPhone: '+374 11 222333' },
        req,
      );
      expect(saved).toMatchObject({
        organisationName: 'Acme Holdings',
        contactPhone: '+374 11 222333',
        displayName: 'Ani',
      });
    });

    it('updates one field without clearing the other', async () => {
      const actor = await customer();
      await profiles.updateMyCustomerProfile(actor, { organisationName: 'Acme' }, req);
      const after = await profiles.updateMyCustomerProfile(actor, { contactPhone: '+374 1' }, req);
      expect(after).toMatchObject({ organisationName: 'Acme', contactPhone: '+374 1' });
    });

    it('accepts an update that names nothing', async () => {
      const actor = await customer();
      await profiles.updateMyCustomerProfile(actor, { organisationName: 'Kept' }, req);
      const after = await profiles.updateMyCustomerProfile(actor, {}, req);
      expect(after.organisationName).toBe('Kept');
    });
  });
});
