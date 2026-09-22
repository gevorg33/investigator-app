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
      // Every state past acceptance carries the moment of it (`assignments_accepted_at_consistent`),
      // so a test can ask for an IN_PROGRESS assignment and get one the database would accept.
      acceptedAt:
        (input.status ?? 'PENDING_ACCEPTANCE') === 'PENDING_ACCEPTANCE' ? null : new Date(),
      paymentReference: input.paymentReference ?? `pi_${randomUUID()}`,
      paymentAuthorizedAt: new Date(),
      acceptanceDueAt: input.acceptanceDueAt ?? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return row!;
}

/**
 * A source recorded on an assignment (T-031). Private and of unknown reliability unless a test
 * says otherwise — the same defaults the service applies — so a test about sharing states only
 * that it shared one.
 */
export async function investigationSource(
  db: TestDb,
  input: {
    assignmentId: string;
    addedBy: string;
    type?: (typeof schema.investigationSources.type.enumValues)[number];
    title?: string;
    shared?: boolean;
    reliability?: (typeof schema.investigationSources.reliability.enumValues)[number];
    reliabilityRationale?: string;
  },
): Promise<typeof schema.investigationSources.$inferSelect> {
  const [row] = await db
    .insert(schema.investigationSources)
    .values({
      assignmentId: input.assignmentId,
      addedBy: input.addedBy,
      type: input.type ?? 'REGISTRY',
      title: input.title ?? 'Company register extract',
      shared: input.shared ?? false,
      reliability: input.reliability ?? 'UNKNOWN',
      reliabilityRationale: input.reliabilityRationale ?? null,
    })
    .returning();
  return row!;
}
