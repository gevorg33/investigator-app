import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import {
  RATING_MAX,
  RATING_MIN,
  REMOVAL_REASON_MAX,
  REMOVAL_REASON_MIN,
  REPORT_REASON_MAX,
  REPORT_REASON_MIN,
  TEXT_MAX,
} from './reviews.policy';

/**
 * The customer's review of a completed assignment: a rating, and words if they want to add some.
 * The words wait for moderation before anyone but the two parties can read them.
 */
export class CreateReviewDto {
  @IsInt()
  @Min(RATING_MIN)
  @Max(RATING_MAX)
  rating!: number;

  @IsOptional()
  @IsString()
  @Length(1, TEXT_MAX)
  text?: string;
}

/** The investigator's one response. Moderated like the review. */
export class RespondToReviewDto {
  @IsString()
  @Length(1, TEXT_MAX)
  text!: string;
}

/** The other party's words, sent back to moderation. Nobody reports their own. */
export class ReportReviewTextDto {
  @IsIn(['REVIEW', 'RESPONSE'])
  part!: 'REVIEW' | 'RESPONSE';

  @IsString()
  @Length(REPORT_REASON_MIN, REPORT_REASON_MAX)
  reason!: string;
}

/** A moderator's decision on a text. Hiding says why, and the author is shown it. */
export class ModerateReviewTextDto {
  @IsIn(['PUBLISH', 'HIDE'])
  decision!: 'PUBLISH' | 'HIDE';

  @IsOptional()
  @IsString()
  @Length(REPORT_REASON_MIN, REPORT_REASON_MAX)
  reason?: string;
}

/** Staff removal of a whole review — rating and words — with the reason that is audited. */
export class RemoveReviewDto {
  @IsString()
  @Length(REMOVAL_REASON_MIN, REMOVAL_REASON_MAX)
  reason!: string;
}

export class ReviewListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
