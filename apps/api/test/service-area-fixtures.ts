import { randomUUID } from 'node:crypto';
import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Actor } from '../src/common/authz/contract';
import * as schema from '../src/database/schema';
import { testActor } from './authz-cases';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** An investigator with a real profile row. Published and accepting work unless told otherwise. */
export async function investigator(
  db: TestDb,
  opts: { visibility?: 'DRAFT' | 'PUBLISHED'; acceptingWork?: boolean; status?: Actor['status'] } = {},
): Promise<{ actor: Actor; profileId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `sa-${randomUUID()}@example.test`, status: 'ACTIVE' })
    .returning();
  const [profile] = await db
    .insert(schema.investigatorProfiles)
    .values({
      userId: user?.id ?? '',
      visibility: opts.visibility ?? 'PUBLISHED',
      acceptingWork: opts.acceptingWork ?? true,
    })
    .returning();
  return {
    actor: testActor({ userId: user?.id ?? '', roles: ['INVESTIGATOR'], status: opts.status ?? 'ACTIVE' }),
    profileId: profile?.id ?? '',
  };
}

/**
 * A random, coarsened place for one test. The coverage query is global, and other suites leave
 * areas behind; drawing each test's geography somewhere random keeps them from colliding.
 */
export function somewhere(): { lon: number; lat: number } {
  const lon = Math.round((Math.random() * 300 - 150) * 100) / 100;
  const lat = Math.round((Math.random() * 100 - 50) * 100) / 100;
  return { lon, lat };
}

/** A square boundary of `sizeDeg` degrees with its south-west corner at `at`, open (not closed). */
export function square(at: { lon: number; lat: number }, sizeDeg: number): Array<{ lon: number; lat: number }> {
  return [
    { lon: at.lon, lat: at.lat },
    { lon: at.lon + sizeDeg, lat: at.lat },
    { lon: at.lon + sizeDeg, lat: at.lat + sizeDeg },
    { lon: at.lon, lat: at.lat + sizeDeg },
  ];
}
