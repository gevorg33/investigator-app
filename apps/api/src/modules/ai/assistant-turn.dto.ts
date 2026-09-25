import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../database/schema';

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
}

/** Answering again the question a failed or stopped turn left unanswered. */
export class RetryTurnDto {
  @IsOptional()
  @IsIn(KNOWLEDGE_LOCALES)
  locale?: KnowledgeLocale;
}
