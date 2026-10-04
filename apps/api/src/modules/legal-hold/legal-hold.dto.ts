import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  LEGAL_HOLD_RESOURCES,
  LEGAL_HOLD_STATUSES,
  REASON_MAX,
  REASON_MIN,
  type LegalHoldResource,
  type LegalHoldStatus,
} from './legal-hold.policy';

/**
 * Places a hold on one resource (T-035). The reason names what the hold answers — the preservation
 * request, the case, counsel's instruction — and is read by staff only.
 */
export class PlaceLegalHoldDto {
  @IsIn(LEGAL_HOLD_RESOURCES)
  resourceType!: LegalHoldResource;

  @IsUUID()
  resourceId!: string;

  @IsString()
  @Length(REASON_MIN, REASON_MAX)
  @Matches(/\S/, { message: 'error.validation.legal_hold.reason_required' })
  reason!: string;
}

/** Releases a hold: a deliberate act with a reason of its own, never a side effect. */
export class ReleaseLegalHoldDto {
  @IsString()
  @Length(REASON_MIN, REASON_MAX)
  @Matches(/\S/, { message: 'error.validation.legal_hold.reason_required' })
  reason!: string;
}

/**
 * Holds, newest first. `resourceType` and `resourceId` narrow it to one resource and come
 * together; `status` is ACTIVE unless asked otherwise — what is held now is the usual question.
 */
export class LegalHoldListQueryDto {
  @IsOptional()
  @IsIn(LEGAL_HOLD_RESOURCES)
  resourceType?: LegalHoldResource;

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsIn(LEGAL_HOLD_STATUSES)
  status?: LegalHoldStatus;

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
