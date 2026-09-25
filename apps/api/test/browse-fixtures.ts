import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import * as schema from '../src/database/schema';
import { completeDraft } from './mission-fixtures';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

type MissionStatus = (typeof schema.missionStatus.enumValues)[number];

export interface PostedOptions {
  customerId?: string;
  status?: MissionStatus;
  title?: string;
  description?: string;
  location?: { lon: number; lat: number } | null;
  deadline?: string;
  budgetMinMinor?: number;
  budgetMaxMinor?: number;
  currency?: string;
  languages?: string[];
}

/** A customer, for missions that belong to somebody. */
export async function missionOwner(db: TestDb): Promise<string> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `browse-customer-${randomUUID()}@example.test`, status: 'ACTIVE' })
    .returning();
  return user!.id;
}

/**
 * A mission under `taxonomyNodeId`, published (QUOTED) unless a test says otherwise.
 *
 * Inserted at its status directly, as `quotableMission` does: the route there is T-010's to test.
 * The database still insists on a complete, confirmed mission beyond DRAFT, and sets
 * `published_at` itself on entry into QUOTED.
 */
export async function posted(
  db: TestDb,
  taxonomyNodeId: string,
  opts: PostedOptions = {},
): Promise<string> {
  const status = opts.status ?? 'QUOTED';
  const draft = completeDraft(taxonomyNodeId);
  const [row] = await db
    .insert(schema.missions)
    .values({
      customerId: opts.customerId ?? (await missionOwner(db)),
      ...draft,
      status,
      ...(status === 'DRAFT'
        ? {}
        : { lawfulPurposeConfirmedAt: new Date(), submittedAt: new Date() }),
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      ...(opts.location != null ? { location: opts.location } : {}),
      ...(opts.deadline !== undefined ? { deadline: opts.deadline } : {}),
      ...(opts.budgetMinMinor !== undefined ? { budgetMinMinor: opts.budgetMinMinor } : {}),
      ...(opts.budgetMaxMinor !== undefined ? { budgetMaxMinor: opts.budgetMaxMinor } : {}),
      ...(opts.currency !== undefined ? { currency: opts.currency } : {}),
      ...(opts.languages !== undefined ? { languages: opts.languages } : {}),
    })
    .returning({ id: schema.missions.id });
  return row!.id;
}

/**
 * Moves a mission's publication into the past. The column is the database's to set — the trigger
 * refuses writers — so this runs as the owner with triggers off for its own transaction only.
 */
export async function backdate(
  owner: postgres.Sql,
  missionId: string,
  days: number,
): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`UPDATE missions SET published_at = now() - make_interval(days => ${days}) WHERE id = ${missionId}`;
  });
}

/** Sets a mission's publication time exactly, for ordering tests that need a known order. */
export async function publishedAt(owner: postgres.Sql, missionId: string, at: Date): Promise<void> {
  await owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`UPDATE missions SET published_at = ${at.toISOString()}::timestamptz WHERE id = ${missionId}`;
  });
}

/** An investigator's service area as a buffered point, the way the service writes one. */
export async function areaAt(
  db: TestDb,
  profileId: string,
  centre: { lon: number; lat: number },
  radiusKm: number,
): Promise<string> {
  const radiusM = radiusKm * 1000;
  const [row] = await db
    .insert(schema.serviceAreas)
    .values({
      profileId,
      kind: 'RADIUS',
      label: 'Second area',
      countryCode: 'AM',
      centre,
      radiusM,
      area: sql`ST_Buffer(ST_SetSRID(ST_MakePoint(${centre.lon}, ${centre.lat}), 4326)::geography, ${radiusM})`,
    })
    .returning({ id: schema.serviceAreas.id });
  return row!.id;
}
