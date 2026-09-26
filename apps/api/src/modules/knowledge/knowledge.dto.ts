import { IsIn } from 'class-validator';
import { KNOWLEDGE_LOCALES, type KnowledgeLocale } from '../../database/schema';

/** `GET /knowledge/documents/:docKey`'s query. In a `.dto.ts` file so the OpenAPI plugin sees it (T-136). */
export class ReadDocumentQuery {
  /** The reader's language; the English version when the article has none in it. */
  @IsIn(KNOWLEDGE_LOCALES)
  locale!: KnowledgeLocale;
}
