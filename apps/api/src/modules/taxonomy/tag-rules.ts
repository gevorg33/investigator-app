import { and, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import type { Db, Tx } from '../../database/database.module';
import { tags } from '../../database/schema';

/** The most tags a mission carries: a refinement, not a second description. */
export const MAX_MISSION_TAGS = 8;

/**
 * Every id is an ACTIVE tag in the vocabulary, or the whole set is refused (T-055). Used where a
 * customer suggests tags and where a moderator confirms them: nothing outside the curated
 * vocabulary, and nothing retired, is put on a mission. `messageKey` is written out at each call so
 * the clients' catalog test can find it (T-135).
 */
export async function requireActiveTags(
  db: Db | Tx,
  ids: readonly string[],
  field: string,
): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const found = await db
    .select({ id: tags.id, status: tags.status })
    .from(tags)
    .where(inArray(tags.id, unique));
  if (found.length !== unique.length) {
    throw AppError.validation([
      { field, code: 'UNKNOWN', messageKey: 'error.validation.tags.unknown' },
    ]);
  }
  if (found.some((t) => t.status !== 'ACTIVE')) {
    throw AppError.validation([
      { field, code: 'DEPRECATED', messageKey: 'error.validation.tags.deprecated' },
    ]);
  }
}

/** Whether a tag exists and is ACTIVE — what a merge target must be. */
export async function isActiveTag(db: Db | Tx, id: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.status, 'ACTIVE')));
  return row !== undefined;
}
