import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { subjectRelationship } from '../../database/schema';
// The same shape service areas use. Longitude first, as in PostGIS.
import { LonLatDto } from '../service-areas/service-areas.dto';
import {
  BUDGET_MAX_MINOR,
  DESCRIPTION_MAX,
  LOCATION_LABEL_MAX,
  MAX_LANGUAGES,
  PURPOSE_MAX,
  CANCEL_REASON_MAX,
  TITLE_MAX,
} from './missions.policy';

const RELATIONSHIPS = subjectRelationship.enumValues;

/**
 * A draft, saved in as many sittings as the customer likes. Every field is optional here and
 * required at submission instead — a form that refuses to save until it is complete is a form
 * people abandon.
 *
 * `null` clears a field; omitting it leaves it alone.
 */
export class SaveMissionDraftDto {
  @IsOptional()
  @IsUUID()
  taxonomyNodeId?: string | null;

  @IsOptional()
  @MaxLength(TITLE_MAX)
  title?: string | null;

  @IsOptional()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  /** ISO 3166-1 alpha-2 — the jurisdiction the work happens in. */
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'error.validation.country_code.invalid' })
  countryCode?: string | null;

  @IsOptional()
  @MaxLength(LOCATION_LABEL_MAX)
  locationLabel?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatDto)
  location?: LonLatDto | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'error.validation.date.invalid' })
  startBy?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'error.validation.date.invalid' })
  deadline?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BUDGET_MAX_MINOR)
  budgetMinMinor?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(BUDGET_MAX_MINOR)
  budgetMaxMinor?: number | null;

  /** ISO 4217. Meaningless without it: 5000 is not an amount. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'error.validation.currency.invalid' })
  currency?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_LANGUAGES)
  @Matches(/^[a-z]{2}$/, { each: true, message: 'error.validation.language_code.invalid' })
  languages?: string[] | null;

  @IsOptional()
  @MaxLength(PURPOSE_MAX)
  purpose?: string | null;

  @IsOptional()
  @IsIn(RELATIONSHIPS)
  subjectRelationship?: (typeof RELATIONSHIPS)[number] | null;

  @IsOptional()
  @IsBoolean()
  protectiveOrderDeclared?: boolean | null;
}

/**
 * The version the client last read. Every write that changes an existing mission carries one,
 * so two people editing the same mission cannot silently overwrite each other — the second
 * write is refused and the client re-reads.
 */
export class VersionedDto {
  @IsInt()
  @Min(1)
  version!: number;
}

export class UpdateMissionDraftDto extends SaveMissionDraftDto {
  @IsInt()
  @Min(1)
  version!: number;
}

export class SubmitMissionDto extends VersionedDto {
  /**
   * Must be exactly `true`. This is the customer's lawful-purpose confirmation, and it is
   * required before a mission can be submitted — recorded with its timestamp, and cleared if
   * the mission comes back for changes so that a resubmission is confirmed afresh.
   */
  @IsIn([true], { message: 'error.validation.lawful_purpose.required' })
  lawfulPurposeConfirmed!: true;
}

export class CancelMissionDto extends VersionedDto {
  @IsOptional()
  @MaxLength(CANCEL_REASON_MAX)
  reason?: string;
}
