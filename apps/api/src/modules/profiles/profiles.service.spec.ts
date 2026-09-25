import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../common/audit/audit.service';
import { LegalService } from '../legal/legal.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import {
  auditLogs,
  investigatorAvailability,
  investigatorLanguages,
  investigatorProfiles,
  taxonomyNodes,
  users,
} from '../../database/schema';
import { testActor } from '../../../test/actor';
import { ProfilesService } from './profiles.service';
import {
  OwnCustomerProfileRepository,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';
import { testPool } from '../../../test/db';
import { roleDocumentIds } from '../../../test/legal-fixtures';
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

  const investigator = async (): Promise<Actor> => {
    const [user] = await ownerDb
      .insert(users)
      .values({ email: `persist-${randomUUID()}@example.test`, displayName: 'Nairi' })
      .returning();
    const actor = testActor({ userId: user?.id ?? '', roles: ['INVESTIGATOR'] });
    await profiles.activateRole(
      actor,
      'INVESTIGATOR',
      req,
      await roleDocumentIds(ownerSql, 'INVESTIGATOR'),
    );
    return actor;
  };

  const node = async (): Promise<string> => {
    const [n] = await ownerDb
      .insert(taxonomyNodes)
      .values({ slug: `n-${randomUUID()}` })
      .returning();
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
        contactPhone: '555-0102',
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
      contactPhone: '555-0102',
      displayName: 'Nairi',
    });
    expect(saved.languages).toHaveLength(2);
    expect([...saved.specialtyNodeIds].sort()).toEqual([a, b].sort());
    expect(saved.availability).toEqual([{ dayOfWeek: 1, startMinute: 540, endMinute: 1020 }]);
  });

  it('tells the owner where verification stands, which the public never sees', async () => {
    const actor = await investigator();
    const own = await profiles.getMyInvestigatorProfile(actor, req);
    expect(own.verificationStatus).toBe('UNVERIFIED');
    const preview = await profiles.previewMyInvestigatorProfile(actor, req);
    expect(preview).not.toHaveProperty('verificationStatus');
  });

  it('previews a draft exactly as the public projection, owner-only fields left out', async () => {
    const actor = await investigator();
    const saved = await profiles.updateMyInvestigatorProfile(
      actor,
      {
        headline: 'Records research',
        contactPhone: '555-0107',
        languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
      },
      req,
    );
    expect(saved.visibility).toBe('DRAFT');
    const preview = await profiles.previewMyInvestigatorProfile(actor, req);
    // Exactly the public field set: the same function builds both, so they cannot drift.
    expect(Object.keys(preview).sort()).toEqual(
      [
        'id',
        'displayName',
        'headline',
        'bio',
        'yearsExperience',
        'pricingModel',
        'hourlyRateMinor',
        'currency',
        'acceptingWork',
        'verified',
        'languages',
        'specialtyNodeIds',
        'availability',
      ].sort(),
    );
    // Whether the investigator is verified is public (T-120); where an application stands is not.
    expect(preview.verified).toBe(false);
    expect(preview).not.toHaveProperty('verificationStatus');
    expect(preview).toMatchObject({
      headline: 'Records research',
      displayName: 'Nairi',
      languages: [{ languageCode: 'hy', proficiency: 'NATIVE' }],
    });
    expect(JSON.stringify(preview)).not.toContain('555-0107');
  });

  it('has no preview for someone who is not an investigator', async () => {
    const [user] = await ownerDb
      .insert(users)
      .values({ email: `persist-${randomUUID()}@example.test` })
      .returning();
    const customer = testActor({ userId: user!.id, roles: ['CUSTOMER'] });
    await expect(profiles.previewMyInvestigatorProfile(customer, req)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it.each([
    ['VERIFIED', true],
    ['PENDING', false],
    ['REJECTED', false],
  ] as const)(
    'tells customers only whether the investigator is verified — %s is shown as %s (T-120)',
    async (status, verified) => {
      const actor = await investigator();
      await ownerDb
        .update(investigatorProfiles)
        .set({ verificationStatus: status, verifiedAt: status === 'VERIFIED' ? new Date() : null })
        .where(eq(investigatorProfiles.userId, actor.userId));
      const preview = await profiles.previewMyInvestigatorProfile(actor, req);
      expect(preview.verified).toBe(verified);
      // Under review and not approved look the same from outside: both are "not verified".
      expect(JSON.stringify(preview)).not.toContain(status === 'VERIFIED' ? 'PENDING' : status);
    },
  );

  describe('the name customers see (T-123)', () => {
    const setStatus = async (actor: Actor, status: 'VERIFIED' | 'PENDING') =>
      ownerDb
        .update(investigatorProfiles)
        .set({
          verificationStatus: status,
          verifiedAt: status === 'VERIFIED' ? new Date() : null,
        })
        .where(eq(investigatorProfiles.userId, actor.userId));

    it('is set on the account while unverified, trimmed, and its change audited on its own', async () => {
      const actor = await investigator();
      const saved = await profiles.updateMyInvestigatorProfile(
        actor,
        { displayName: '  Ani Petrosyan  ' },
        req,
      );
      expect(saved.displayName).toBe('Ani Petrosyan');
      const [account] = await ownerDb.select().from(users).where(eq(users.id, actor.userId));
      expect(account!.displayName).toBe('Ani Petrosyan');
      const events = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, actor.userId));
      const renamed = events.filter((e) => e.action === 'profile.display_name_changed');
      expect(renamed).toHaveLength(1);
      // The names themselves are not copied into the log.
      expect(JSON.stringify(renamed)).not.toContain('Petrosyan');
    });

    it.each([['VERIFIED' as const], ['PENDING' as const]])(
      'is locked while %s — verification checked the documents against it',
      async (status) => {
        const actor = await investigator();
        await setStatus(actor, status);
        const e = await profiles
          .updateMyInvestigatorProfile(actor, { displayName: 'Someone Else', headline: 'x' }, req)
          .catch((x: unknown) => x);
        expect(e).toMatchObject({
          code: 'VALIDATION_FAILED',
          details: [
            {
              field: 'displayName',
              code: 'LOCKED',
              messageKey: 'error.validation.display_name.locked',
            },
          ],
        });
        // Refused whole: nothing else in the request was saved either.
        expect((await profiles.getMyInvestigatorProfile(actor, req)).headline).not.toBe('x');
      },
    );

    it('lets a verified investigator save the rest of the form with their name unchanged', async () => {
      const actor = await investigator();
      await setStatus(actor, 'VERIFIED');
      const saved = await profiles.updateMyInvestigatorProfile(
        actor,
        { displayName: 'Nairi', headline: 'Still me' },
        req,
      );
      expect(saved).toMatchObject({ displayName: 'Nairi', headline: 'Still me' });
      const events = await ownerDb
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.actorId, actor.userId));
      expect(events.some((e) => e.action === 'profile.display_name_changed')).toBe(false);
    });
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

  describe('a retired taxonomy node (ADR-0007 rule 1, T-053)', () => {
    const retired = async (): Promise<string> => {
      const id = await node();
      await ownerDb
        .update(taxonomyNodes)
        .set({ status: 'DEPRECATED' })
        .where(eq(taxonomyNodes.id, id));
      return id;
    };

    it('cannot be newly declared', async () => {
      const actor = await investigator();
      await expect(
        profiles.updateMyInvestigatorProfile(actor, { specialtyNodeIds: [await retired()] }, req),
      ).rejects.toMatchObject({
        details: [expect.objectContaining({ code: 'DEPRECATED_TAXONOMY_NODE' })],
      });
    });

    it('stays declared by someone who had it, through every later save', async () => {
      const actor = await investigator();
      const kept = await node();
      const added = await node();
      await profiles.updateMyInvestigatorProfile(actor, { specialtyNodeIds: [kept] }, req);
      await ownerDb
        .update(taxonomyNodes)
        .set({ status: 'DEPRECATED' })
        .where(eq(taxonomyNodes.id, kept));

      // The client sends the whole set on every save. Refusing the retired node here would lock
      // this investigator out of editing their profile over a decision they did not make.
      const saved = await profiles.updateMyInvestigatorProfile(
        actor,
        { headline: 'Still editing', specialtyNodeIds: [kept, added] },
        req,
      );
      expect([...saved.specialtyNodeIds].sort()).toEqual([kept, added].sort());
    });

    it('is refused alongside a held one when it is the new addition', async () => {
      const actor = await investigator();
      const held = await node();
      await profiles.updateMyInvestigatorProfile(actor, { specialtyNodeIds: [held] }, req);
      await expect(
        profiles.updateMyInvestigatorProfile(
          actor,
          { specialtyNodeIds: [held, await retired()] },
          req,
        ),
      ).rejects.toMatchObject({
        details: [expect.objectContaining({ code: 'DEPRECATED_TAXONOMY_NODE' })],
      });
    });
  });

  describe('customer profile', () => {
    const customer = async (): Promise<Actor> => {
      const [user] = await ownerDb
        .insert(users)
        .values({ email: `cust-${randomUUID()}@example.test`, displayName: 'Ani' })
        .returning();
      const actor = testActor({ userId: user?.id ?? '', roles: ['CUSTOMER'] });
      await profiles.activateRole(
        actor,
        'CUSTOMER',
        req,
        await roleDocumentIds(ownerSql, 'CUSTOMER'),
      );
      return actor;
    };

    it('round-trips its fields', async () => {
      const actor = await customer();
      const saved = await profiles.updateMyCustomerProfile(
        actor,
        { organisationName: 'Acme Holdings', contactPhone: '555-0103' },
        req,
      );
      expect(saved).toMatchObject({
        organisationName: 'Acme Holdings',
        contactPhone: '555-0103',
        displayName: 'Ani',
      });
    });

    it('updates one field without clearing the other', async () => {
      const actor = await customer();
      await profiles.updateMyCustomerProfile(actor, { organisationName: 'Acme' }, req);
      const after = await profiles.updateMyCustomerProfile(
        actor,
        { contactPhone: '555-0105' },
        req,
      );
      expect(after).toMatchObject({ organisationName: 'Acme', contactPhone: '555-0105' });
    });

    it('accepts an update that names nothing', async () => {
      const actor = await customer();
      await profiles.updateMyCustomerProfile(actor, { organisationName: 'Kept' }, req);
      const after = await profiles.updateMyCustomerProfile(actor, {}, req);
      expect(after.organisationName).toBe('Kept');
    });
  });
});
