import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const PRICING_MODELS = ['HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED'] as const;
const PROFICIENCIES = ['BASIC', 'CONVERSATIONAL', 'FLUENT', 'NATIVE'] as const;
const VISIBILITIES = ['DRAFT', 'PUBLISHED'] as const;

export class LanguageDto {
  // Lower-case ISO 639-1, matching the database constraint. Checked in both places: the
  // constraint protects the table from every writer, this gives the client a usable error.
  @Matches(/^[a-z]{2}$/, { message: 'error.validation.language_code.invalid' })
  languageCode!: string;

  @IsIn(PROFICIENCIES)
  proficiency!: (typeof PROFICIENCIES)[number];
}

export class AvailabilityWindowDto {
  /** 0 = Monday (ISO 8601) through 6 = Sunday. */
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute!: number;
}

export class UpdateInvestigatorProfileDto {
  /**
   * The name customers see (T-123). It lives on the account, and can change only while no
   * application is under review and none has been approved — verification checks documents
   * against a name, and "verified" must keep meaning that name (owner decision, 2026-09-25).
   * `\S` so a name of spaces is refused.
   */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Matches(/\S/, { message: 'error.validation.display_name.blank' })
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  bio?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(80)
  yearsExperience?: number;

  @IsOptional()
  @IsIn(PRICING_MODELS)
  pricingModel?: (typeof PRICING_MODELS)[number];

  /** Minor units. An integer because a rate is money and money is not a float. */
  @IsOptional()
  @IsInt()
  @Min(0)
  hourlyRateMinor?: number;

  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'error.validation.currency.invalid' })
  currency?: string;

  @IsOptional()
  @IsBoolean()
  acceptingWork?: boolean;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;

  // Bounded: each of these replaces the whole set, and an unbounded array is a way to make
  // one request write an arbitrary number of rows.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => LanguageDto)
  languages?: LanguageDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  specialtyNodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  availability?: AvailabilityWindowDto[];
}

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;
}

export class ActivateRoleDto {
  // STAFF is deliberately absent: staff roles are granted by staff, never self-activated.
  @IsIn(['CUSTOMER', 'INVESTIGATOR'])
  role!: 'CUSTOMER' | 'INVESTIGATOR';

  /**
   * The documents being accepted, by id — so the record says which exact version and locale was
   * shown (T-021). Empty is valid: with nothing published there is nothing to accept, and the
   * gate refuses only when something required is in force and missing from this list.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(36, 36, { each: true })
  acceptedDocumentIds?: string[];
}
