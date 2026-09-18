import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeStorage } from '../../../test/media-fixtures';
import {
  applicant,
  area,
  cursorBefore,
  document,
  longAgo,
  reviewer,
  specialty,
  submittedAt,
  type TestDb,
} from '../../../test/verification-fixtures';
import { AuditService } from '../../common/audit/audit.service';
import { AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import * as schema from '../../database/schema';
import {
  auditLogs,
  investigatorProfiles,
  serviceAreas,
  verificationDecisions,
  verificationRequests,
} from '../../database/schema';
import { MemoryRateLimitStore, RateLimitService } from '../auth/rate-limit.service';
import { OwnMediaRepository, ViewableMediaRepository } from '../media/media.repository';
import { MediaService } from '../media/media.service';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { VerificationService } from './verification.service';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

describe('verification', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  let storage: FakeStorage;
  let service: VerificationService;
  const req = () => ({ ip: '198.51.100.30', userAgent: 'vitest', correlationId: randomUUID() });

  beforeAll(() => {
    sql = postgres(URL, { max: 8, onnotice: () => {} });
    db = drizzle(sql, { schema });
  });

  beforeEach(() => {
    const audit = new AuditService(db);
    const authz = new AuthzService(audit);
    storage = new FakeStorage();
    const media = new MediaService(
      db,
      authz,
      audit,
      new RateLimitService(new MemoryRateLimitStore()),
      new OwnMediaRepository(db),
      new ViewableMediaRepository(db),
      storage,
    );
    service = new VerificationService(
      db,
      authz,
      audit,
      media,
      new OwnInvestigatorProfileRepository(db),
    );
  });

  afterAll(async () => {
    await sql.end();
  });

  const profileOf = async (profileId: string) => {
    const [row] = await db
      .select()
      .from(investigatorProfiles)
      .where(eq(investigatorProfiles.id, profileId));
    return row!;
  };

  const auditFor = (resourceId: string, action: string) =>
    db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.resourceId, resourceId), eq(auditLogs.action, action)));

  /** An applicant with one clean document, applied. */
  const applied = async (opts: Parameters<typeof applicant>[1] = {}) => {
    const who = await applicant(db, opts);
    const doc = await document(db, who.userId);
    const request = await service.submit(who.actor, { documentIds: [doc] }, req());
    return { ...who, doc, request };
  };

  const decide = (
    staff: Actor,
    requestId: string,
    outcome: 'APPROVED' | 'REJECTED',
    reason = 'Licence checked against the registry.',
  ) => service.decide(staff, requestId, { outcome, reason }, req());

  describe('applying', () => {
    it('opens a request, freezes the declaration and makes the profile PENDING', async () => {
      const who = await applicant(db);
      const node = await specialty(db, who.profileId);
      const areaId = await area(db, who.profileId, 'Yerevan city');
      const doc = await document(db, who.userId);

      const request = await service.submit(who.actor, { documentIds: [doc] }, req());

      expect(request).toMatchObject({
        status: 'SUBMITTED',
        decidedAt: null,
        documentIds: [doc],
        decision: null,
        declaredScope: {
          specialtyNodeIds: [node],
          serviceAreas: [
            {
              id: areaId,
              label: 'Yerevan city',
              countryCode: 'AM',
              region: 'Yerevan',
              city: 'Yerevan',
            },
          ],
        },
      });
      expect((await profileOf(who.profileId)).verificationStatus).toBe('PENDING');
      const [row] = await auditFor(request.id, 'verification.submitted');
      expect(row).toMatchObject({ actorId: who.userId, actorRole: 'INVESTIGATOR' });
    });

    it('does not move the declaration a reviewer checks against when the profile changes', async () => {
      const who = await applicant(db);
      const areaId = await area(db, who.profileId, 'Before');
      const doc = await document(db, who.userId);
      const request = await service.submit(who.actor, { documentIds: [doc] }, req());

      await db.update(serviceAreas).set({ label: 'After' }).where(eq(serviceAreas.id, areaId));
      await area(db, who.profileId, 'Added later');

      const staff = await reviewer(db);
      const review = await service.getForReview(staff, request.id, req());
      expect(review.declaredScope.serviceAreas).toEqual([
        expect.objectContaining({ id: areaId, label: 'Before' }),
      ]);
    });

    it('records each document once when the same id is sent twice', async () => {
      const who = await applicant(db);
      const doc = await document(db, who.userId);
      const request = await service.submit(who.actor, { documentIds: [doc, doc] }, req());
      expect(request.documentIds).toEqual([doc]);
    });

    it('moves a REJECTED profile back to PENDING', async () => {
      const { profileId } = await applied({ verificationStatus: 'REJECTED' });
      expect((await profileOf(profileId)).verificationStatus).toBe('PENDING');
    });

    it('leaves a VERIFIED profile verified while additions are reviewed', async () => {
      const { profileId, verifiedAt } = await applied({ verificationStatus: 'VERIFIED' });
      const profile = await profileOf(profileId);
      expect(profile.verificationStatus).toBe('VERIFIED');
      expect(profile.verifiedAt).toEqual(verifiedAt);
    });

    it('accepts a document whose scan is still running', async () => {
      const who = await applicant(db);
      const doc = await document(db, who.userId, { scanStatus: 'PENDING' });
      await expect(service.submit(who.actor, { documentIds: [doc] }, req())).resolves.toMatchObject(
        {
          status: 'SUBMITTED',
        },
      );
    });

    it('refuses a second open application', async () => {
      const { actor, userId, request } = await applied();
      const doc = await document(db, userId);
      await expect(service.submit(actor, { documentIds: [doc] }, req())).rejects.toMatchObject({
        code: 'STATE_CONFLICT',
      });
      // The first is untouched.
      const [row] = await db
        .select()
        .from(verificationRequests)
        .where(eq(verificationRequests.id, request.id));
      expect(row?.status).toBe('SUBMITTED');
    });

    it('accepts a new application once the last one was decided', async () => {
      const { actor, userId, request } = await applied();
      await decide(await reviewer(db), request.id, 'REJECTED', 'The licence number is illegible.');
      const doc = await document(db, userId);
      await expect(service.submit(actor, { documentIds: [doc] }, req())).resolves.toMatchObject({
        status: 'SUBMITTED',
      });
    });

    it.each([
      ['someone else’s document', 'foreign'],
      ['a profile image', 'image'],
      ['a deleted document', 'deleted'],
      ['an id that does not exist', 'missing'],
    ] as const)('refuses %s as not found', async (_label, kind) => {
      const who = await applicant(db);
      const other = await applicant(db);
      const doc =
        kind === 'foreign'
          ? await document(db, other.userId)
          : kind === 'image'
            ? await document(db, who.userId, { category: 'PROFILE_IMAGE' })
            : kind === 'deleted'
              ? await document(db, who.userId, { deleted: true })
              : randomUUID();
      await expect(service.submit(who.actor, { documentIds: [doc] }, req())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ field: 'documentIds', code: 'NOT_FOUND' })],
      });
      expect((await profileOf(who.profileId)).verificationStatus).toBe('UNVERIFIED');
    });

    it.each([
      ['an unfinished upload', { ready: false }],
      ['an infected file', { scanStatus: 'INFECTED' as const }],
      ['a file the scanner failed on', { scanStatus: 'FAILED' as const }],
    ])('refuses %s as not ready', async (_label, opts) => {
      const who = await applicant(db);
      const good = await document(db, who.userId);
      const bad = await document(db, who.userId, opts);
      await expect(
        service.submit(who.actor, { documentIds: [good, bad] }, req()),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [expect.objectContaining({ field: 'documentIds', code: 'NOT_READY' })],
      });
    });

    it('refuses someone who is not an investigator', async () => {
      const staff = await reviewer(db);
      await expect(
        service.submit(staff, { documentIds: [randomUUID()] }, req()),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('answers an investigator with no profile as not found', async () => {
      const staff = await reviewer(db, { roles: ['INVESTIGATOR'], staffScopes: [] });
      await expect(
        service.submit(staff, { documentIds: [randomUUID()] }, req()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('refuses a suspended account', async () => {
      const who = await applicant(db);
      const doc = await document(db, who.userId);
      await expect(
        service.submit({ ...who.actor, status: 'SUSPENDED' }, { documentIds: [doc] }, req()),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('the applicant’s own list', () => {
    it('is empty before anything is submitted', async () => {
      const who = await applicant(db);
      expect(await service.listMine(who.actor, req())).toEqual([]);
    });

    it('shows each decision’s reason, newest first, and never who made it', async () => {
      const { actor, userId, request: first } = await applied();
      await decide(await reviewer(db), first.id, 'REJECTED', '  The ID has expired.  ');
      const doc = await document(db, userId);
      const second = await service.submit(actor, { documentIds: [doc] }, req());

      const list = await service.listMine(actor, req());

      expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
      expect(list[0]).toMatchObject({ status: 'SUBMITTED', decision: null, documentIds: [doc] });
      expect(list[1]).toMatchObject({
        status: 'REJECTED',
        decision: { outcome: 'REJECTED', reason: 'The ID has expired.' },
      });
      expect(list[1]?.decision).not.toHaveProperty('decidedBy');
    });

    it('does not include anyone else’s applications', async () => {
      await applied();
      const who = await applicant(db);
      expect(await service.listMine(who.actor, req())).toEqual([]);
    });
  });

  describe('who may review', () => {
    it.each([
      ['an investigator', { roles: ['INVESTIGATOR' as const], staffScopes: [] }],
      ['staff without the VERIFICATION scope', { staffScopes: ['MODERATION' as const] }],
      [
        'staff working as an investigator',
        { roles: ['STAFF' as const, 'INVESTIGATOR' as const], activeRole: 'INVESTIGATOR' as const },
      ],
    ])('refuses %s everywhere', async (_label, opts) => {
      const { request, doc } = await applied();
      const actor = await reviewer(db, opts);
      for (const attempt of [
        () => service.queue(actor, {}, req()),
        () => service.getForReview(actor, request.id, req()),
        () => decide(actor, request.id, 'APPROVED'),
        () => service.openDocument(actor, request.id, doc, req()),
      ]) {
        await expect(attempt()).rejects.toMatchObject({ status: 403 });
      }
    });
  });

  describe('the queue', () => {
    it('lists open applications oldest first, a page at a time', async () => {
      const at = longAgo();
      const a = await applied();
      const b = await applied();
      const c = await applied();
      // b and c share an instant, so the id decides between them.
      await submittedAt(db, a.request.id, at);
      await submittedAt(db, b.request.id, new Date(at.getTime() + 1000));
      await submittedAt(db, c.request.id, new Date(at.getTime() + 1000));
      const tied = [b.request.id, c.request.id].sort();

      const staff = await reviewer(db);
      const first = await service.queue(staff, { limit: 2, cursor: cursorBefore(at) }, req());
      expect(first.items.map((i) => i.id)).toEqual([a.request.id, tied[0]]);
      expect(first.items[0]).toMatchObject({ profileId: a.profileId, documentCount: 1 });
      expect(first.pageInfo.hasNextPage).toBe(true);

      const second = await service.queue(
        staff,
        { limit: 1, cursor: first.pageInfo.nextCursor! },
        req(),
      );
      expect(second.items.map((i) => i.id)).toEqual([tied[1]]);
    });

    it('drops an application once it is decided', async () => {
      const at = longAgo();
      const { request } = await applied();
      await submittedAt(db, request.id, at);
      const staff = await reviewer(db);
      await decide(staff, request.id, 'APPROVED');

      const page = await service.queue(staff, { limit: 1, cursor: cursorBefore(at) }, req());
      expect(page.items.map((i) => i.id)).not.toContain(request.id);
    });

    it('ends the sequence with no cursor', async () => {
      const staff = await reviewer(db);
      // Past every submission there can be.
      const page = await service.queue(
        staff,
        { cursor: cursorBefore(new Date('9999-01-01T00:00:00Z')) },
        req(),
      );
      expect(page).toEqual({ items: [], pageInfo: { nextCursor: null, hasNextPage: false } });
    });

    it('starts from the oldest open application without a cursor, and clamps the limit', async () => {
      await applied();
      const staff = await reviewer(db);
      const page = await service.queue(staff, { limit: 0 }, req());
      expect(page.items).toHaveLength(1);
      expect(page.pageInfo.hasNextPage).toBe(true);
    });

    it('refuses a cursor it did not issue', async () => {
      const staff = await reviewer(db);
      await expect(service.queue(staff, { cursor: 'not-a-cursor' }, req())).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });
  });

  describe('reviewing one application', () => {
    it('shows the documents, the profile and every earlier decision', async () => {
      const staff = await reviewer(db);
      const { actor, userId, profileId, request: first } = await applied();
      await decide(staff, first.id, 'REJECTED', 'The document is cropped.');
      const docA = await document(db, userId);
      const docB = await document(db, userId, { scanStatus: 'PENDING' });
      const second = await service.submit(actor, { documentIds: [docA, docB] }, req());

      const review = await service.getForReview(staff, second.id, req());

      expect(review).toMatchObject({
        id: second.id,
        status: 'SUBMITTED',
        profile: { id: profileId, userId, verificationStatus: 'PENDING', verifiedAt: null },
      });
      expect(review.documents).toHaveLength(2);
      expect(review.documents).toEqual(
        expect.arrayContaining([
          {
            mediaAssetId: docA,
            declaredMimeType: 'application/pdf',
            bytes: 1000,
            scanStatus: 'CLEAN',
          },
          {
            mediaAssetId: docB,
            declaredMimeType: 'application/pdf',
            bytes: 1000,
            scanStatus: 'PENDING',
          },
        ]),
      );
      expect(review.trail).toEqual([
        {
          requestId: second.id,
          status: 'SUBMITTED',
          submittedAt: second.submittedAt,
          decision: null,
        },
        {
          requestId: first.id,
          status: 'REJECTED',
          submittedAt: first.submittedAt,
          decision: expect.objectContaining({
            outcome: 'REJECTED',
            reason: 'The document is cropped.',
            decidedBy: staff.userId,
          }),
        },
      ]);
    });

    it('answers an unknown application as not found', async () => {
      const staff = await reviewer(db);
      await expect(service.getForReview(staff, randomUUID(), req())).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('deciding', () => {
    it('approving verifies the profile and records who decided, and why', async () => {
      const { profileId, request } = await applied();
      const staff = await reviewer(db);

      const decided = await decide(
        staff,
        request.id,
        'APPROVED',
        '  Licence matches the registry.  ',
      );

      expect(decided).toMatchObject({
        requestId: request.id,
        status: 'APPROVED',
        decision: {
          outcome: 'APPROVED',
          reason: 'Licence matches the registry.',
          decidedBy: staff.userId,
        },
      });
      const profile = await profileOf(profileId);
      expect(profile.verificationStatus).toBe('VERIFIED');
      expect(profile.verifiedAt).toEqual(decided.decision?.decidedAt);

      const [row] = await db
        .select()
        .from(verificationRequests)
        .where(eq(verificationRequests.id, request.id));
      expect(row).toMatchObject({ status: 'APPROVED', version: 2 });
      expect(row?.decidedAt).toEqual(decided.decision?.decidedAt);
      const [audit] = await auditFor(request.id, 'verification.approved');
      expect(audit).toMatchObject({ actorId: staff.userId, actorRole: 'STAFF' });
    });

    it('rejecting marks the profile REJECTED', async () => {
      const { profileId, request } = await applied();
      const staff = await reviewer(db);
      await decide(staff, request.id, 'REJECTED', 'The name does not match the licence.');

      expect((await profileOf(profileId)).verificationStatus).toBe('REJECTED');
      expect(await auditFor(request.id, 'verification.rejected')).toHaveLength(1);
    });

    it('rejecting an addition leaves an existing verification standing', async () => {
      const { profileId, verifiedAt, request } = await applied({ verificationStatus: 'VERIFIED' });
      await decide(await reviewer(db), request.id, 'REJECTED', 'No licence for the new region.');

      const profile = await profileOf(profileId);
      expect(profile.verificationStatus).toBe('VERIFIED');
      expect(profile.verifiedAt).toEqual(verifiedAt);
    });

    it('approving an addition keeps the original verification date', async () => {
      const { profileId, verifiedAt, request } = await applied({ verificationStatus: 'VERIFIED' });
      await decide(await reviewer(db), request.id, 'APPROVED');
      expect((await profileOf(profileId)).verifiedAt).toEqual(verifiedAt);
    });

    it('never records a decision before the submission, even when the clock steps back', async () => {
      // Seen in the full suite: the database's clock stepped back 74 ms between a submission
      // and its decision, and the decision was refused by the CHECK. A submission timed ahead
      // of the deciding transaction's now() reproduces that on demand.
      const { request } = await applied();
      const ahead = new Date(Date.now() + 60 * 60_000);
      await submittedAt(db, request.id, ahead);

      const decided = await decide(await reviewer(db), request.id, 'APPROVED');

      expect(decided.decision?.decidedAt).toEqual(ahead);
    });

    it('decides a request once', async () => {
      const { request } = await applied();
      const staff = await reviewer(db);
      await decide(staff, request.id, 'APPROVED');
      await expect(decide(staff, request.id, 'REJECTED')).rejects.toMatchObject({ status: 403 });
      const decisions = await db
        .select()
        .from(verificationDecisions)
        .where(eq(verificationDecisions.requestId, request.id));
      expect(decisions).toHaveLength(1);
    });

    it('produces one decision when two reviewers act at once', async () => {
      const { request } = await applied();
      const [one, two] = [await reviewer(db), await reviewer(db)];
      const results = await Promise.allSettled([
        decide(one, request.id, 'APPROVED'),
        decide(two, request.id, 'REJECTED'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: expect.objectContaining({ status: 403 }),
      });
      const decisions = await db
        .select()
        .from(verificationDecisions)
        .where(eq(verificationDecisions.requestId, request.id));
      expect(decisions).toHaveLength(1);
    });

    it('refuses a reviewer deciding their own application', async () => {
      const self = await applicant(db, {
        roles: ['INVESTIGATOR', 'STAFF'],
        staffScopes: ['VERIFICATION'],
      });
      const doc = await document(db, self.userId);
      const request = await service.submit(
        { ...self.actor, activeRole: 'INVESTIGATOR' },
        { documentIds: [doc] },
        req(),
      );

      await expect(
        decide({ ...self.actor, activeRole: 'STAFF' }, request.id, 'APPROVED'),
      ).rejects.toMatchObject({ status: 403 });
      expect((await profileOf(self.profileId)).verificationStatus).toBe('PENDING');
    });

    it('answers an unknown application as not found', async () => {
      await expect(decide(await reviewer(db), randomUUID(), 'APPROVED')).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('opening a document', () => {
    it('issues a short-lived link and records which application it was opened for', async () => {
      const { request, doc } = await applied();
      const staff = await reviewer(db);

      const link = await service.openDocument(staff, request.id, doc, req());

      expect(link.signedUrl).toContain('signature=');
      expect(link.expiresAt.getTime()).toBeGreaterThan(Date.now());
      const [opened] = await auditFor(request.id, 'verification.document_opened');
      expect(opened).toMatchObject({ actorId: staff.userId, actorRole: 'STAFF', reason: doc });
      // The media module's own delivery record is written too: one path, not a second one.
      expect(await auditFor(doc, 'media.delivered')).toHaveLength(1);
    });

    it('refuses a document not yet scanned clean, and records no opening', async () => {
      const who = await applicant(db);
      const doc = await document(db, who.userId, { scanStatus: 'PENDING' });
      const request = await service.submit(who.actor, { documentIds: [doc] }, req());

      await expect(
        service.openDocument(await reviewer(db), request.id, doc, req()),
      ).rejects.toMatchObject({ status: 403 });
      expect(await auditFor(request.id, 'verification.document_opened')).toEqual([]);
    });

    it('answers a document from another application as not found', async () => {
      const mine = await applied();
      const theirs = await applied();
      await expect(
        service.openDocument(await reviewer(db), mine.request.id, theirs.doc, req()),
      ).rejects.toMatchObject({ status: 404 });
      expect(storage.signedDownloadUrl).not.toHaveBeenCalled();
    });
  });
});
