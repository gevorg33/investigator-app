import { IsIn, IsOptional } from 'class-validator';
import { IsTimeZone } from '../../common/validation/time-zone';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../database/schema';

/** The account's own preferences. Only what is sent changes. */
export class UpdatePreferencesDto {
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;

  @IsOptional()
  @IsTimeZone()
  timezone?: string;
}
