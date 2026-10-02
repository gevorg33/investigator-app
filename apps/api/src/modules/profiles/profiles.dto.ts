import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const PRICING_MODELS = ['HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED'] as const;
const PUBLIC_NAME_CHOICES = ['PSEUDONYM', 'LEGAL'] as const;
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

/**
 * What makes up an investigator's storefront: everything on the profile except who the person is.
 * An agency managing a profile it holds (T-087) writes these and nothing more — the legal name is
 * the person's own, and whether customers see it waits for the agent's consent (T-183).
 */
export class InvestigatorStorefrontDto {
  /**
   * The name customers know the investigator by (T-181) — theirs to choose, and the only one
   * customers ever see unless the holder chooses otherwise. Unique without case; may not
   * share a word with the legal name or carry contact details (`pseudonym.ts`). `null` clears it,
   * and customers see the stand-in code again.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/\S/, { message: 'error.validation.pseudonym.blank' })
  @Length(2, 60, { message: 'error.validation.pseudonym.length' })
  pseudonym?: string | null;

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

/** The holder's own changes: the storefront, plus their legal name and which name customers see. */
export class UpdateInvestigatorProfileDto extends InvestigatorStorefrontDto {
  /**
   * The legal name (T-123), which verification checks — never shown to customers, who see the
   * pseudonym below (T-181). It lives on the account, and can change only while no
   * application is under review and none has been approved — verification checks documents
   * against a name, and "verified" must keep meaning that name (owner decision, 2026-09-25).
   * `\S` so a name of spaces is refused.
   */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  @Matches(/\S/, { message: 'error.validation.display_name.blank' })
  displayName?: string;

  /**
   * Which name customers know the investigator by (T-182): `PSEUDONYM`, the default, or `LEGAL` —
   * the name above, which verification checks. Their choice, changeable at any time.
   */
  @IsOptional()
  @IsIn(PUBLIC_NAME_CHOICES)
  publicName?: (typeof PUBLIC_NAME_CHOICES)[number];
}

/** An agency's changes to a profile it holds (T-087): the storefront only. */
export class UpdateAgencyInvestigatorDto extends InvestigatorStorefrontDto {}

/** A profile the agency makes for one of its members, who will hold it (T-087). */
export class CreateAgencyInvestigatorDto {
  @IsUUID()
  membershipId!: string;
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
