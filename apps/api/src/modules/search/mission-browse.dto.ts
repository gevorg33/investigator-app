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
  ValidateNested,
} from 'class-validator';
import { MAX_FILTER_VALUES } from './search.policy';

/** The orders an investigator may browse in (T-054). `relevance` needs `q`, and `q` needs it. */
export const MISSION_SORTS = ['newest', 'closest', 'budget', 'deadline', 'relevance'] as const;
export type MissionSort = (typeof MISSION_SORTS)[number];

/** How far beyond a service area's edge a distance filter may reach, in kilometres. */
export const MAX_BROWSE_DISTANCE_KM = 200;

/** How far back "posted within" may reach, in days. */
export const MAX_POSTED_WITHIN_DAYS = 365;

/** Largest amount a budget filter takes, in minor units: the column is a 32-bit integer. */
const MAX_MINOR = 2_147_483_647;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What an investigator may narrow the published missions by: **typed and closed**
 * (docs/api/pagination.md), like discovery's filters. Every field narrows the set eligibility has
 * already decided; none can widen it, and none names eligibility itself — there is no status, no
 * "include drafts", nothing that could be set to see what an investigator may not.
 *
 * Tags are not here: they do not exist until T-055, which specifies where search consumes them.
 */
export class MissionBrowseFiltersDto {
  /**
   * Shared taxonomy node ids. A mission matches when it is filed at a requested node, below one,
   * or above one — the tree is walked both ways, as discovery walks it (ADR-0007).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID(undefined, { each: true })
  taxonomyNodeIds?: string[];

  /** ISO 4217. Required with a budget filter or the budget sort: budgets in different currencies do not compare. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'error.validation.currency.invalid' })
  currency?: string;

  /** The mission's budget range must reach at least this, in minor units. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  budgetMinMinor?: number;

  /** The mission's budget range must start at or below this, in minor units. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MINOR)
  budgetMaxMinor?: number;

  /** The mission's deadline is on or after this date. Missions without a deadline are left out. */
  @IsOptional()
  @Matches(DATE, { message: 'error.validation.date.invalid' })
  deadlineFrom?: string;

  /** The mission's deadline is on or before this date. Missions without a deadline are left out. */
  @IsOptional()
  @Matches(DATE, { message: 'error.validation.date.invalid' })
  deadlineTo?: string;

  /**
   * One of the investigator's own service areas, to measure distance from. Without it, distance
   * is measured from the nearest of them.
   */
  @IsOptional()
  @IsUUID()
  serviceAreaId?: string;

  /**
   * Only missions this far from the service area's edge, or closer; 0 means inside it. Missions
   * without a location are left out.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BROWSE_DISTANCE_KM)
  withinKm?: number;

  /**
   * ISO 639-1: the languages the investigator works in. A mission matches when every language it
   * requires is among them — a mission needing Armenian and English is not one an English-only
   * investigator can take.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @Matches(/^[a-z]{2}$/, { each: true, message: 'error.validation.language_code.invalid' })
  languages?: string[];

  /** Published within this many days. Relative, so a saved search still means "recent" later. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_POSTED_WITHIN_DAYS)
  postedWithinDays?: number;

  /**
   * Free text. It **orders** the eligible missions by how well their title and description match
   * — it never removes one (`investigator-discovery`). So it goes with `sort: relevance`, which is
   * also the default when it is given.
   */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  q?: string;

  @IsOptional()
  @IsIn(MISSION_SORTS)
  sort?: MissionSort;
}

/** A browse request: the filters, and where in the result to start. */
export class BrowseMissionsDto extends MissionBrowseFiltersDto {
  /** Clamped, never rejected (docs/api/pagination.md). */
  @IsOptional()
  @IsInt()
  limit?: number;

  /** Opaque. Clients must not parse, construct or modify it. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

/** Saving a browse under a name, to run again later. */
export class SaveMissionSearchDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @ValidateNested()
  @Type(() => MissionBrowseFiltersDto)
  filters!: MissionBrowseFiltersDto;
}
