import { MAX_MISSION_TAGS } from '../taxonomy/tag-rules';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { NOTE_MAX, REASON_MAX } from './mission-moderation.policy';

export const MODERATION_OUTCOMES = ['PUBLISHED', 'REJECTED', 'CHANGES_REQUESTED'] as const;
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number];

/**
 * A moderator's decision on one mission under review (T-051).
 *
 * The outcome is always chosen — there is no default for screening or a model to have filled in.
 * The reason is required for all three: for a rejection or a request for changes it is what the
 * customer reads, as written; for a publication it is the record of why. `\S` rather than a bare
 * length, so a reason of spaces is refused. The note is staff-only and optional.
 *
 * `version` is the mission the moderator read. A mission that moved since — cancelled, or decided
 * by someone else — is refused rather than decided blind.
 */
export class DecideModerationDto {
  @IsIn(MODERATION_OUTCOMES)
  outcome!: ModerationOutcome;

  @IsString()
  @Length(1, REASON_MAX)
  @Matches(/\S/, { message: 'error.validation.moderation.reason_required' })
  reason!: string;

  @IsOptional()
  @IsString()
  @Length(1, NOTE_MAX)
  @Matches(/\S/, { message: 'error.validation.moderation.note_empty' })
  internalNote?: string;

  @IsInt()
  @Min(1)
  version!: number;

  /**
   * The tags the mission is published with (T-055): the moderator confirms the customer's
   * suggestions they agree with and may add others, all from the curated vocabulary. Publication
   * only — a rejected or returned mission carries no confirmed tag. Omitted, none is confirmed.
   */
  // Present means validated: `@IsOptional` would let `null` through.
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(MAX_MISSION_TAGS)
  @IsUUID(undefined, { each: true })
  tagIds?: string[];
}

/** The queue, most sensitive band first, then longest waiting. The limit is clamped by the service. */
export class ModerationQueueQueryDto {
  // A query string is text; implicit conversion is off globally, so this field says so itself.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  /** Opaque. Clients must not parse, construct or modify it. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

/** The periods the latency report covers, in days back from now. */
export const LATENCY_PERIODS = [30, 90, 365] as const;
export type LatencyPeriod = (typeof LATENCY_PERIODS)[number];

/** Review latency over the last `days` (T-193). Ninety unless asked otherwise. */
export class LatencyQueryDto {
  // A query string is text; implicit conversion is off globally, so this field says so itself.
  @IsOptional()
  @Type(() => Number)
  @IsIn(LATENCY_PERIODS)
  days?: LatencyPeriod;
}
