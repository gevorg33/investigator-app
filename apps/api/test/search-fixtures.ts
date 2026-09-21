import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Actor } from '../src/common/authz/contract';
import * as schema from '../src/database/schema';
import { testActor } from './actor';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface DiscoverableOptions {
  /** Everything below defaults to "this investigator should be found", so a test that is about
   * one exclusion states only that exclusion. */
  verificationStatus?: 'UNVERIFIED' | 'PENDING' | 'VERIFIED' | 'REJECTED';
  visibility?: 'DRAFT' | 'PUBLISHED';
  acceptingWork?: boolean;
  accountStatus?: Actor['status'];
  deleted?: boolean;

  displayName?: string;
  yearsExperience?: number;
  pricingModel?: 'HOURLY' | 'FIXED_FEE' | 'RETAINER' | 'MIXED';

  /** The service area. Centre must already be coarse — the database refuses more precision. */
  centre?: { lon: number; lat: number };
  radiusKm?: number;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  /** Skip the service area entirely, for tests about investigators with nowhere to work. */
  withoutArea?: boolean;

  languages?: string[];
  specialtyNodeIds?: string[];
  availability?: Array<{ dayOfWeek: number; startMinute: number; endMinute: number }>;
}

export interface Discoverable {
  userId: string;
  profileId: string;
  actor: Actor;
  centre: { lon: number; lat: number };
}

/**
 * An investigator who would be found by a search, unless an option says otherwise.
 *
 * Verified, published, accepting work and active — the four eligibility conditions — plus a
 * service area. A test proving one of them excludes someone flips exactly one option, so the
 * test says what it is about.
 */
export async function discoverable(
  db: TestDb,
  opts: DiscoverableOptions = {},
): Promise<Discoverable> {
  const centre = opts.centre ?? somewhere();
  const verificationStatus = opts.verificationStatus ?? 'VERIFIED';

  const [user] = await db
    .insert(schema.users)
    .values({
      email: `search-${randomUUID()}@example.test`,
      status: opts.accountStatus ?? 'ACTIVE',
      displayName: opts.displayName ?? 'Test Investigator',
      ...(opts.deleted === true ? { deletedAt: new Date() } : {}),
    })
    .returning();
  const userId = user?.id ?? '';

  const [profile] = await db
    .insert(schema.investigatorProfiles)
    .values({
      userId,
      visibility: opts.visibility ?? 'PUBLISHED',
      acceptingWork: opts.acceptingWork ?? true,
      verificationStatus,
      // The database refuses a verification date without the status, and the status without one.
      verifiedAt: verificationStatus === 'VERIFIED' ? new Date() : null,
      ...(opts.yearsExperience !== undefined ? { yearsExperience: opts.yearsExperience } : {}),
      ...(opts.pricingModel !== undefined ? { pricingModel: opts.pricingModel } : {}),
    })
    .returning();
  const profileId = profile?.id ?? '';

  if (opts.withoutArea !== true) {
    const radiusM = (opts.radiusKm ?? 10) * 1000;
    await db.insert(schema.serviceAreas).values({
      profileId,
      kind: 'RADIUS',
      label: 'Work area',
      countryCode: opts.countryCode === undefined ? 'AM' : opts.countryCode,
      region: opts.region === undefined ? 'Yerevan' : opts.region,
      city: opts.city === undefined ? 'Yerevan' : opts.city,
      centre,
      radiusM,
      // Buffered in the database, exactly as the service does it.
      area: sql`ST_Buffer(ST_SetSRID(ST_MakePoint(${centre.lon}, ${centre.lat}), 4326)::geography, ${radiusM})`,
    });
  }

  for (const languageCode of opts.languages ?? ['en']) {
    await db
      .insert(schema.investigatorLanguages)
      .values({ profileId, languageCode, proficiency: 'FLUENT' });
  }
  for (const taxonomyNodeId of opts.specialtyNodeIds ?? []) {
    await db.insert(schema.investigatorSpecialties).values({ profileId, taxonomyNodeId });
  }
  for (const window of opts.availability ?? []) {
    await db.insert(schema.investigatorAvailability).values({ profileId, ...window });
  }

  return {
    userId,
    profileId,
    actor: testActor({ userId, roles: ['INVESTIGATOR'] }),
    centre,
  };
}

/** A customer to search as. Discovery needs an actor, not a role. */
export async function searcher(
  db: TestDb,
  opts: { status?: Actor['status'] } = {},
): Promise<Actor> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `searcher-${randomUUID()}@example.test`, status: opts.status ?? 'ACTIVE' })
    .returning();
  return testActor({
    userId: user?.id ?? '',
    roles: ['CUSTOMER'],
    status: opts.status ?? 'ACTIVE',
  });
}

/** A taxonomy node, optionally under a parent, for the tree-walking tests. */
export async function node(db: TestDb, opts: { parentId?: string } = {}): Promise<string> {
  const [row] = await db
    .insert(schema.taxonomyNodes)
    .values({
      slug: `search-node-${randomUUID()}`,
      ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}),
    })
    .returning();
  return row?.id ?? '';
}

/**
 * A value no other test uses, for isolating a search.
 *
 * Random geography is not enough on its own. Discovery is global, every suite that creates an
 * investigator now creates a **verified** one, and the development database accumulates
 * hundreds of them at random points — so a search with a 50 km radius can find somebody else's
 * fixture and take the first result. Tagging this test's investigators and filtering on the tag
 * makes a search answer with this test's data or nothing.
 */
export function isolate(): string {
  return `iso-${randomUUID()}`;
}

/**
 * A random coarse point. Discovery queries are global and other suites leave areas behind, so
 * each test draws its own geography somewhere nobody else is.
 */
export function somewhere(): { lon: number; lat: number } {
  const lon = Math.round((Math.random() * 300 - 150) * 100) / 100;
  const lat = Math.round((Math.random() * 100 - 50) * 100) / 100;
  return { lon, lat };
}

/** A point `km` east of another, coarsened the way the database demands. */
export function eastOf(
  point: { lon: number; lat: number },
  km: number,
): { lon: number; lat: number } {
  const degrees = km / (111.32 * Math.cos((point.lat * Math.PI) / 180));
  return { lon: Math.round((point.lon + degrees) * 100) / 100, lat: point.lat };
}
