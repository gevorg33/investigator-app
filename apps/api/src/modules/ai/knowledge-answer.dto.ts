import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../database/schema';

/** One question about how the platform works (T-017). */
export class AskKnowledgeDto {
  /** Long enough for a real question with its context; not a document to be summarised. */
  @IsString()
  @Length(3, 2000)
  question!: string;

  /** The language to answer in. The user's chosen language when absent. */
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;
}
