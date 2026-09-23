import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** How much explanation a decline or halt may carry. Enough to be specific, not a document. */
export const REASON_MAX = 1000;

/**
 * Declining an assignment before accepting it.
 *
 * The reason is optional in general and load-bearing in one case: a policy concern opens a
 * staff review of the mission, "because material that worried you will worry the next
 * investigator too". T-050 builds that review; this records the ground it will rest on.
 */
/** Why an investigator declines. Only POLICY_CONCERN opens a staff review (T-050). */
export const DECLINE_REASONS = [
  'POLICY_CONCERN',
  'UNAVAILABLE',
  'OUTSIDE_EXPERTISE',
  'OTHER',
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export class DeclineAssignmentDto {
  @IsOptional()
  @IsIn(DECLINE_REASONS)
  reasonCode?: DeclineReason;

  /**
   * Free text. For a policy concern it is the ground staff review, at least 20 characters, and it
   * is never shown to the customer (T-050); otherwise optional.
   */
  @IsOptional()
  @IsString()
  @MaxLength(REASON_MAX)
  reason?: string;
}

/** Stopping accepted work on lawful grounds (T-050). The ground is what staff review. */
export class HaltAssignmentDto {
  @IsString()
  @Length(20, 2000)
  ground!: string;
}

/** What staff decide about the money when a halted assignment is cancelled. */
export class MoneyDecisionDto {
  @IsIn(['FULL_REFUND', 'SPLIT', 'HOLD'])
  decision!: 'FULL_REFUND' | 'SPLIT' | 'HOLD';

  /** SPLIT only: what the investigator is paid for work lawfully done; the rest is refunded. */
  @IsOptional()
  @IsInt()
  @Min(0)
  investigatorAmountMinor?: number;

  @IsString()
  @Length(5, 2000)
  reason!: string;
}

/** A moderator's decision on a policy review (T-050). */
export class ResolvePolicyReviewDto {
  @IsIn(['SUBSTANTIATED', 'UNSUBSTANTIATED'])
  finding!: 'SUBSTANTIATED' | 'UNSUBSTANTIATED';

  /** Only with UNSUBSTANTIATED: the refusal was an excuse, not a mistake. */
  @IsOptional()
  @IsBoolean()
  badFaith?: boolean;

  /** A halt only: resume the work, or cancel the assignment. */
  @IsOptional()
  @IsIn(['RESUME', 'CANCEL'])
  disposition?: 'RESUME' | 'CANCEL';

  @IsString()
  @Length(20, 4000)
  reasoning!: string;

  /** Required when cancelling a halted assignment: the money is decided separately (T-050). */
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyDecisionDto)
  money?: MoneyDecisionDto;
}

export class PolicyReviewQueueQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

/** Accepting carries nothing: the terms are already fixed by the quote. */
export class AcceptAssignmentDto {}
