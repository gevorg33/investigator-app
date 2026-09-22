import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { investigationSourceType, sourceReliability } from '../../database/schema';

const TYPES = investigationSourceType.enumValues;
const RELIABILITIES = sourceReliability.enumValues;

/** A new source. Reliability defaults to UNKNOWN; any other value needs its rationale. */
export class CreateSourceDto {
  @IsIn(TYPES)
  type!: (typeof TYPES)[number];

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  locator?: string;

  @IsOptional()
  @IsISO8601()
  accessedAt?: string;

  @IsOptional()
  @IsIn(RELIABILITIES)
  reliability?: (typeof RELIABILITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reliabilityRationale?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}

/** Any subset of the same fields. The assignment and who recorded it do not change. */
export class UpdateSourceDto {
  @IsOptional()
  @IsIn(TYPES)
  type?: (typeof TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  locator?: string;

  @IsOptional()
  @IsISO8601()
  accessedAt?: string;

  @IsOptional()
  @IsIn(RELIABILITIES)
  reliability?: (typeof RELIABILITIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reliabilityRationale?: string;

  @IsOptional()
  @IsBoolean()
  shared?: boolean;
}
