import { eq } from 'drizzle-orm';
import type { Db } from '../../database/database.module';
import { KNOWLEDGE_LOCALES, users, type KnowledgeLocale } from '../../database/schema';

/**
 * The language the user chose, read now rather than trusted from anything older. A saved language
 * the assistant is not written in answers in English.
 */
export async function savedLocale(db: Db, userId: string): Promise<KnowledgeLocale> {
  const rows = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
  const known = rows
    .map((r) => r.locale)
    .find((l): l is KnowledgeLocale => (KNOWLEDGE_LOCALES as readonly string[]).includes(l));
  return known ?? 'en';
}
