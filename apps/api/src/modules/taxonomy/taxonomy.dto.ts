import {
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
} from 'class-validator';
import { riskBand, taxonomyNodeStatus, TAXONOMY_LOCALES } from '../../database/schema';

const RISK_BANDS = riskBand.enumValues;
const STATUSES = taxonomyNodeStatus.enumValues;

/**
 * Why the change was made, in words (T-053). Every staff edit to the taxonomy carries one: a
 * node's band decides how its missions are moderated, and "who changed it" is only half of
 * what anyone will ask later.
 */
export class Reasoned {
  @IsString()
  @Length(12, 500)
  reason!: string;
}

/** The locale a caller reads in. English when absent, and English for anything untranslated. */
export class TaxonomyReadQuery {
  @IsOptional()
  @IsIn(TAXONOMY_LOCALES)
  locale?: (typeof TAXONOMY_LOCALES)[number];
}

export class CreateTaxonomyNodeDto extends Reasoned {
  /** Permanent (ADR-0007 rule 1): lowercase words joined by hyphens. The database checks it too. */
  @IsString()
  @Length(2, 80)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug!: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;

  /**
   * Required, not defaulted. Screening treats an unbanded node as HIGH, so a default would be
   * either wrong or meaningless; the person adding the node is the one who has to decide.
   */
  @IsIn(RISK_BANDS)
  riskBand!: (typeof RISK_BANDS)[number];

  /** The English label, which every other locale falls back to — so a node cannot exist without it. */
  @IsString()
  @Length(1, 120)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

/** What may change about a node after it exists. Its slug and parent may not (ADR-0007). */
export class UpdateTaxonomyNodeDto extends Reasoned {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  position?: number;

  @IsOptional()
  @IsIn(RISK_BANDS)
  riskBand?: (typeof RISK_BANDS)[number];

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class SetTaxonomyLabelDto extends Reasoned {
  @IsString()
  @Length(1, 120)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
