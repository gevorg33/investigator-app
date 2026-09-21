import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema';
import type { TestDb } from './mission-fixtures';

/**
 * The assignment a paid-for quote becomes.
 *
 * Its terms are copied from the quote rather than invented, because that is what acceptance
 * does: an assignment whose scope differs from the quote the customer paid for is not a
 * fixture of anything real. Everything a test is likely to vary — the status, the deadline,
 * the payment reference — is an override with a sensible default (T-042).
 *
 * Inserted directly. Driving it through payment authorization is T-111's to test, and this
 * exists so that everything downstream of an assignment has one to work with.
 */
export async function assignment(
  db: TestDb,
  input: {
    quoteId: string;
    customerId: string;
    status?: (typeof schema.assignments.status.enumValues)[number];
    paymentReference?: string;
    acceptanceDueAt?: Date;
  },
): Promise<typeof schema.assignments.$inferSelect> {
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, input.quoteId));
  if (quote === undefined) throw new Error(`no quote ${input.quoteId} to assign`);

  const [row] = await db
    .insert(schema.assignments)
    .values({
      missionId: quote.missionId,
      quoteId: quote.id,
      customerId: input.customerId,
      investigatorProfileId: quote.investigatorProfileId,
      acceptedScope: quote.scope,
      deliverables: quote.deliverables,
      cancellationTerms: quote.cancellationTerms,
      priceMinor: quote.priceMinor,
      currency: quote.currency,
      estimatedDurationDays: quote.estimatedDurationDays,
      status: input.status ?? 'PENDING_ACCEPTANCE',
      paymentReference: input.paymentReference ?? `pi_${randomUUID()}`,
      paymentAuthorizedAt: new Date(),
      acceptanceDueAt: input.acceptanceDueAt ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return row!;
}
