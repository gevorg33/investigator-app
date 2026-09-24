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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../../database/schema';
import { MAX_FILTER_VALUES, MAX_SEARCH_RADIUS_KM } from '../../search/search.policy';
import { LonLatDto } from '../../service-areas/service-areas.dto';

/** A request to the assistant to find investigators (T-018). */
export class FindInvestigatorsDto {
  @IsString()
  @Length(3, 2000)
  question!: string;

  /** The language to answer in. The user's chosen language when absent. */
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;

  /**
   * A real point — the device's location, or a pin the person dropped. In the body, never a URL
   * (docs/architecture/discovery.md). It is used to search and is never sent to the model.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatDto)
  near?: LonLatDto;

  /** How far from `near`. 0, the default, means a service area must cover the point. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEARCH_RADIUS_KM)
  radiusKm?: number;

  /** The specialty chosen from a clarification's options. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID(undefined, { each: true })
  taxonomyNodeIds?: string[];

  /** What the search is for, when the assistant asked. Screened like the question. */
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  purpose?: string;
}
