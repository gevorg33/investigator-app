import { randomUUID } from 'node:crypto';
import * as schema from '../src/database/schema';
import { customer, type TestDb } from './mission-fixtures';

/**
 * A customer with a filled-in profile (T-042).
 *
 * `contactPhone` is deliberately not a real number and not in any country's dialling plan:
 * fixtures carry no personal data that could be mistaken for a person's, and
 * `fixtures.spec.ts` enforces that. The organisation name is equally invented.
 */
export async function customerProfile(
  db: TestDb,
  opts: {
    /** An existing customer to attach the profile to; one is created when it is left out. */
    userId?: string;
    organisationName?: string | null;
    contactPhone?: string | null;
  } = {},
): Promise<{ userId: string; profileId: string }> {
  const userId = opts.userId ?? (await customer(db)).userId;
  const [row] = await db
    .insert(schema.customerProfiles)
    .values({
      userId,
      organisationName:
        opts.organisationName === undefined
          ? `Example Holdings ${randomUUID().slice(0, 6)}`
          : opts.organisationName,
      contactPhone: opts.contactPhone === undefined ? '555-0100' : opts.contactPhone,
    })
    .returning();
  return { userId, profileId: row?.id ?? '' };
}
