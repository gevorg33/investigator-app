import { randomUUID } from 'node:crypto';
import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Actor } from '../src/common/authz/contract';
import * as schema from '../src/database/schema';
import type { RiskBandValue } from '../src/modules/mission-policy/mission-screening';
import { testActor } from './authz-cases';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/** A customer with a real user row. ACTIVE unless a test wants otherwise. */
export async function customer(
  db: TestDb,
  opts: { status?: Actor['status'] } = {},
): Promise<{ actor: Actor; userId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `mission-${randomUUID()}@example.test`, status: 'ACTIVE' })
    .returning();
  const userId = user?.id ?? '';
  return {
    actor: testActor({ userId, roles: ['CUSTOMER'], status: opts.status ?? 'ACTIVE' }),
    userId,
  };
}

/** A taxonomy node to file a mission under. Banded STANDARD unless a test needs otherwise. */
export async function category(
  db: TestDb,
  opts: { riskBand?: RiskBandValue | null; status?: 'ACTIVE' | 'DEPRECATED' } = {},
): Promise<string> {
  const [node] = await db
    .insert(schema.taxonomyNodes)
    .values({
      slug: `test-node-${randomUUID()}`,
      riskBand: opts.riskBand === undefined ? 'STANDARD' : opts.riskBand,
      status: opts.status ?? 'ACTIVE',
    })
    .returning();
  return node?.id ?? '';
}

/**
 * Everything a mission needs to be submittable, so a test that is about one missing field can
 * say so by removing exactly that field.
 */
export function completeDraft(taxonomyNodeId: string) {
  return {
    taxonomyNodeId,
    title: 'Counterparty due diligence before signing',
    description:
      'Ownership, filings and litigation history from public registers and court records.',
    countryCode: 'AM',
    locationLabel: 'Yerevan',
    deadline: inDays(30),
    budgetMinMinor: 50_000,
    budgetMaxMinor: 150_000,
    currency: 'AMD',
    languages: ['en', 'hy'],
    purpose: 'Deciding whether to sign a supply agreement with this company.',
    subjectRelationship: 'BUSINESS_RELATIONSHIP' as const,
  };
}

/** A date `days` from today, as the `date` column stores it. */
export function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
