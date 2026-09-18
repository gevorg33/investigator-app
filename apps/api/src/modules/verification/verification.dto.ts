import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_DOCUMENTS, REASON_MAX } from './verification.policy';

/**
 * Applying for verification: the documents, and nothing else.
 *
 * What was declared — specialties and service areas — is read from the profile and snapshotted
 * by the server, never taken from the request. A client that could say what it declared could
 * say it declared less than it did, and the reviewer would check the documents against the
 * wrong thing.
 */
export class SubmitVerificationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DOCUMENTS)
  @IsUUID(undefined, { each: true })
  documentIds!: string[];
}

/**
 * A reviewer's decision. Whole-application only: approve everything declared, or reject it.
 *
 * The reason is required for both outcomes. For a rejection it is what the applicant acts on;
 * for an approval it is what a later dispute or audit reads to understand why. `\S` rather than
 * a bare length, so a reason of spaces is refused — a length check alone would accept it.
 */
export class DecideVerificationDto {
  @IsIn(['APPROVED', 'REJECTED'])
  outcome!: 'APPROVED' | 'REJECTED';

  @IsString()
  @Length(1, REASON_MAX)
  @Matches(/\S/, { message: 'error.validation.verification.reason_required' })
  reason!: string;
}

/** The queue, oldest first. The limit is clamped by the service rather than capped here. */
export class QueueQueryDto {
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
