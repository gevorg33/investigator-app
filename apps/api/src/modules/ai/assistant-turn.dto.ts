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
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../database/schema';
import { MAX_FILTER_VALUES, MAX_SEARCH_RADIUS_KM } from '../search/search.policy';
import { LonLatDto } from '../service-areas/service-areas.dto';

/** What a person says to the assistant in a conversation (T-056). The same bounds as T-017's. */
export class AskTurnDto {
  @IsString()
  @Length(3, 2000)
  // Three spaces are not a question.
  @Matches(/\S/)
  content!: string;

  /** The language to answer in. The user's chosen language when absent. */
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;

  /**
   * These words answer the question discovery just asked — which specialty, where, what for —
   * rather than ask a new one (T-059). Refused when nothing was asked.
   */
  @IsOptional()
  @IsBoolean()
  clarifies?: boolean;

  /** The specialty picked from those discovery offered. Only with `clarifies`. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_FILTER_VALUES)
  @IsUUID(undefined, { each: true })
  taxonomyNodeIds?: string[];

  /**
   * Where the person is, from their device — for this search only: never stored, never sent to a
   * model. In the body, never a URL. Only with `clarifies`.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => LonLatDto)
  near?: LonLatDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_SEARCH_RADIUS_KM)
  radiusKm?: number;
}

/** Answering again the question a failed or stopped turn left unanswered. */
export class RetryTurnDto {
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;
}
