import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Actor, Role, StaffScope } from '../src/common/authz/contract';
import * as schema from '../src/database/schema';
import { encodeQueueCursor } from '../src/modules/verification/verification.policy';
import { makeReady, person } from './media-fixtures';
import { testActor } from './actor';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

type VerificationStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';

/**
 * An investigator about to apply. UNVERIFIED by default — the opposite of the discovery
 * fixtures, because here the status is the thing under test rather than a precondition.
 */
export async function applicant(
  db: TestDb,
  opts: {
    verificationStatus?: VerificationStatus;
    roles?: Role[];
    staffScopes?: StaffScope[];
  } = {},
): Promise<{ actor: Actor; userId: string; profileId: string; verifiedAt: Date | null }> {
  const status = opts.verificationStatus ?? 'UNVERIFIED';
  const [user] = await db
    .insert(schema.users)
    .values({ email: `verif-${randomUUID()}@example.test`, status: 'ACTIVE' })
    .returning();
  const userId = user?.id ?? '';
  // Whole seconds, so a comparison after a round trip through the database is exact.
  const verifiedAt =
    status === 'VERIFIED' ? new Date(Math.floor(Date.now() / 1000) * 1000 - 86_400_000) : null;
  const [profile] = await db
    .insert(schema.investigatorProfiles)
    .values({ userId, verificationStatus: status, verifiedAt })
    .returning();
  return {
    actor: testActor({
      userId,
      roles: opts.roles ?? ['INVESTIGATOR'],
      staffScopes: opts.staffScopes ?? [],
    }),
    userId,
    profileId: profile?.id ?? '',
    verifiedAt,
  };
}

/**
 * A verification document owned by `ownerId`. Finished and scanned clean unless told otherwise,
 * so a test about the review is about the review.
 */
export async function document(
  db: TestDb,
  ownerId: string,
  opts: {
    ready?: boolean;
    scanStatus?: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
    category?: 'VERIFICATION_DOCUMENT' | 'PROFILE_IMAGE';
    deleted?: boolean;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.mediaAssets)
    .values({
      ownerId,
      category: opts.category ?? 'VERIFICATION_DOCUMENT',
      visibility: 'STAFF_REVIEW_ONLY',
      publicId: `verification/${randomUUID()}`,
      resourceType: 'image',
      declaredMimeType: 'application/pdf',
      declaredBytes: 1000,
      authorizationExpiresAt: new Date(Date.now() + 10 * 60_000),
      ...(opts.deleted === true ? { deletedAt: new Date() } : {}),
    })
    .returning();
  const id = row?.id ?? '';
  if (opts.ready !== false) await makeReady(db, id, opts.scanStatus ?? 'CLEAN');
  return id;
}

/** A reviewer: staff holding the VERIFICATION scope, unless told otherwise. */
export async function reviewer(
  db: TestDb,
  opts: { staffScopes?: StaffScope[]; roles?: Role[]; activeRole?: Role } = {},
): Promise<Actor> {
  return person(db, {
    roles: opts.roles ?? ['STAFF'],
    staffScopes: opts.staffScopes ?? ['VERIFICATION'],
    ...(opts.activeRole === undefined ? {} : { activeRole: opts.activeRole }),
  });
}

/** A declared specialty: a real taxonomy node attached to the profile. */
export async function specialty(db: TestDb, profileId: string): Promise<string> {
  const [node] = await db
    .insert(schema.taxonomyNodes)
    .values({ slug: `verif-node-${randomUUID()}` })
    .returning();
  const id = node?.id ?? '';
  await db.insert(schema.investigatorSpecialties).values({ profileId, taxonomyNodeId: id });
  return id;
}

/** A declared service area, with the text fields the snapshot keeps. */
export async function area(db: TestDb, profileId: string, label = 'Yerevan'): Promise<string> {
  const [row] = await db
    .insert(schema.serviceAreas)
    .values({
      profileId,
      kind: 'RADIUS',
      label,
      countryCode: 'AM',
      region: 'Yerevan',
      city: 'Yerevan',
      centre: { lon: 44.51, lat: 40.18 },
      radiusM: 10_000,
      area: sql`ST_Buffer(ST_SetSRID(ST_MakePoint(44.51, 40.18), 4326)::geography, 10000)`,
    })
    .returning();
  return row?.id ?? '';
}

/**
 * Moves a request to a submission time of the test's choosing.
 *
 * The queue is global and the development database keeps every open request other suites
 * leave behind. Placing this test's requests at a random instant decades ago, and starting the
 * page just before it, makes the queue answer with this test's rows first.
 */
export async function submittedAt(db: TestDb, requestId: string, at: Date): Promise<void> {
  await db
    .update(schema.verificationRequests)
    .set({ submittedAt: at })
    .where(eq(schema.verificationRequests.id, requestId));
}

/** A random instant between 1971 and 2000, whole seconds. */
export function longAgo(): Date {
  const from = Date.UTC(1971, 0, 1);
  const to = Date.UTC(2000, 0, 1);
  return new Date(Math.floor((from + Math.random() * (to - from)) / 1000) * 1000);
}

/** A cursor that starts the queue one millisecond before `at`. */
export function cursorBefore(at: Date): string {
  return encodeQueueCursor({
    submittedAt: new Date(at.getTime() - 1),
    id: '00000000-0000-0000-0000-000000000000',
  });
}
