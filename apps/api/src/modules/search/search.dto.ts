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
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
// Longitude first, as in PostGIS — the same shape service areas use.
import { LonLatDto } from '../service-areas/service-areas.dto';
// MAX_LIMIT is deliberately not imported: the ceiling belongs to `clampLimit`, because the
// pagination contract clamps an oversized limit rather than rejecting it.
import { MAX_FILTER_VALUES, MAX_SEARCH_RADIUS_KM } from './search.policy';

const PRICING_MODELS = ['HOURLY', 'FIXED_FEE', 'RETAINER', 'MIXED'] as const;

/** A window to be available in, in the same shape investigators declare availability. */
export class AvailabilityFilterDto {
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
 * The filters a customer may search on: **typed and closed** (docs/api/pagination.md). No field
 * here reaches the database as text destined for a query, and there is no free-form filter
 * object.
 *
 * Two deliberate absences:
 *
 * **No verification filter**, though plan.md §9 lists verification among the filters. Being
 * verified is not a preference a customer expresses — it is an eligibility invariant, and the
 * only value it could take is VERIFIED. Offering it as a filter would imply the other values
 * are available, and a filter that can be set to "unverified" is the bug this module exists to
 * prevent.
 *
 * **No free-text field.** Relevance ranking over prose belongs to the assistant's discovery
 * tools (T-018) and needs the AI gateway; when it arrives it may only reorder what these
 * filters already allowed (`investigator-discovery`). Leaving it out now keeps that rule
 * structural rather than aspirational.
 */
export class SearchInvestigatorsDto {
  /** ISO 3166-1 alpha-2. Matches the country an investigator declared on a service area. */
  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'error.validation.country_code.invalid' })
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  region?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  city?: string;

  /**
   * Search around a point. Travels in the body, never in a URL: this is often the customer's
   * own location or the subject's, and coordinates do not belong in query strings or logs.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatDto)
  near?: LonLatDto;

  /**
   * How far from `near` to look. 0 — the default — means the point must fall inside a service
   * area, which is what the investigator article promises.
   */
  @ValidateIf((o: SearchInvestigatorsDto) => o.radiusKm !== undefined || o.near !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_SEARCH_RADIUS_KM)
  radiusKm?: number;

  /** ISO 639-1. An investigator must work in every language asked for, not merely one. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @Matches(/^[a-z]{2}$/, { each: true, message: 'error.validation.language_code.invalid' })
  languages?: string[];

  /**
   * Shared taxonomy node ids (ADR-0007). A node matches investigators who declared it or any
   * of its descendants — matching walks the tree, so both sides need not pick the same depth.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID(undefined, { each: true })
  taxonomyNodeIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => AvailabilityFilterDto)
  availableDuring?: AvailabilityFilterDto;

  @IsOptional()
  @IsIn(PRICING_MODELS)
  pricingModel?: (typeof PRICING_MODELS)[number];

  /**
   * Bounded by the server, not by the client: docs/api/pagination.md says a request above the
   * maximum is **clamped, not rejected**, so there is no `@Max` here. `clampLimit` is what
   * decides, and it is the only thing that needs to know the ceiling.
   */
  @IsOptional()
  @IsInt()
  limit?: number;

  /** Opaque. Clients must not parse, construct or modify it. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
