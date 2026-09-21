import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/postgres-js';
import type { Actor } from '../src/common/authz/contract';
import * as schema from '../src/database/schema';
import { testActor } from './actor';
import { category, completeDraft } from './mission-fixtures';
import { discoverable, type Discoverable } from './search-fixtures';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface QuotableMission {
  actor: Actor;
  customerId: string;
  missionId: string;
  taxonomyNodeId: string;
}

/**
 * A mission a moderator has published, which is the only kind an investigator may quote on.
 *
 * Inserted at QUOTED directly rather than driven through the machine: this fixture is about
 * having something to quote on, and the route from DRAFT to QUOTED is T-010's to test. The
 * database still insists on a complete, lawful-purpose-confirmed mission, so the row is a real
 * one — `missions_submission_complete` refuses anything less.
 */
export async function quotableMission(
  db: TestDb,
  opts: { status?: 'QUOTED' | 'DRAFT' | 'CUSTOMER_CONFIRMED' } = {},
): Promise<QuotableMission> {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `quote-customer-${randomUUID()}@example.test`, status: 'ACTIVE' })
    .returning();
  const customerId = user?.id ?? '';
  const taxonomyNodeId = await category(db);
  const status = opts.status ?? 'QUOTED';
  const confirmed =
    status === 'DRAFT' ? {} : { lawfulPurposeConfirmedAt: new Date(), submittedAt: new Date() };

  const [mission] = await db
    .insert(schema.missions)
    .values({ customerId, ...completeDraft(taxonomyNodeId), status, ...confirmed })
    .returning();

  return {
    actor: testActor({ userId: customerId, roles: ['CUSTOMER'] }),
    customerId,
    missionId: mission?.id ?? '',
    taxonomyNodeId,
  };
}

/**
 * An investigator who may quote: published, VERIFIED and accepting work.
 *
 * The same conditions discovery applies, through the same fixture, so the two cannot drift —
 * someone who cannot be found should not be able to arrive through the back door of a quote.
 */
export async function eligibleInvestigator(
  db: TestDb,
  opts: Parameters<typeof discoverable>[1] = {},
): Promise<Discoverable> {
  return discoverable(db, opts);
}

/** A live offer on a mission. Everything is plausible unless a test overrides it. */
export async function submittedQuote(
  db: TestDb,
  input: {
    missionId: string;
    investigatorProfileId: string;
    priceMinor?: number;
    currency?: string;
    expiresAt?: Date;
    status?: 'SUBMITTED' | 'WITHDRAWN' | 'ACCEPTED' | 'CLOSED' | 'EXPIRED';
    /**
     * Ages the quote after inserting it, for tests about expiry.
     *
     * It cannot be inserted already expired: `quotes_expiry_after_creation` refuses a quote
     * born past its own expiry, which is the constraint doing its job — an offer nobody could
     * ever accept is not an offer. The constraint governs the birth of the row, so a quote
     * that was live and then lapsed is written the way time actually produces one.
     */
    expiredFor?: number;
  },
): Promise<typeof schema.quotes.$inferSelect> {
  const status = input.status ?? 'SUBMITTED';
  const [row] = await db
    .insert(schema.quotes)
    .values({
      missionId: input.missionId,
      investigatorProfileId: input.investigatorProfileId,
      status,
      priceMinor: input.priceMinor ?? 250_000,
      currency: input.currency ?? 'AMD',
      estimatedDurationDays: 14,
      scope: 'Up to twelve hours of records research at the declared business address.',
      deliverables: 'A written report with sources listed.',
      assumptions: 'The registered address is current.',
      exclusions: 'No surveillance, no contact with the subject.',
      cancellationTerms: 'Full refund before work starts; pro rata after.',
      expiresAt: input.expiresAt ?? inDays(7),
      // The database keeps these consistent with the status, both ways.
      ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
      ...(status === 'WITHDRAWN' ? { withdrawnAt: new Date() } : {}),
    })
    .returning();

  if (input.expiredFor !== undefined) {
    // Both timestamps move, not just the expiry. `quotes_expiry_after_creation` is checked on
    // every write, not only on insert — an UPDATE that pushed `expires_at` alone into the past
    // is refused, and rightly so. A real lapsed quote was written before its expiry and
    // outlived it, so the row is aged the same way: created a week ago, expired since.
    const expiresAt = new Date(Date.now() - input.expiredFor);
    const [aged] = await db
      .update(schema.quotes)
      .set({ expiresAt, createdAt: new Date(expiresAt.getTime() - 7 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.quotes.id, row!.id))
      .returning();
    return aged!;
  }
  return row!;
}

/** An authorization as the payments module would hand one over (Phase 5). */
export function authorization(over: { amountMinor?: number; currency?: string; at?: Date } = {}) {
  return {
    reference: `pi_test_${randomUUID()}`,
    authorizedAt: over.at ?? new Date(),
    amountMinor: over.amountMinor ?? 250_000,
    currency: over.currency ?? 'AMD',
  };
}

export function inDays(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
