import { IsOptional, IsString, MaxLength } from 'class-validator';

/** How much explanation a decline or halt may carry. Enough to be specific, not a document. */
export const REASON_MAX = 1000;

/**
 * Declining an assignment before accepting it.
 *
 * The reason is optional in general and load-bearing in one case: a policy concern opens a
 * staff review of the mission, "because material that worried you will worry the next
 * investigator too". T-050 builds that review; this records the ground it will rest on.
 */
export class DeclineAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

/** Accepting carries nothing: the terms are already fixed by the quote. */
export class AcceptAssignmentDto {}
