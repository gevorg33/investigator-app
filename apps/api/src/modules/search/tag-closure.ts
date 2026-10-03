import { sql } from 'drizzle-orm';
import type { Db } from '../../database/database.module';

/**
 * Each requested tag with every tag merged into it, directly or through a chain (T-055).
 *
 * Merging retires a tag and names the one it became, and the missions that carried it are never
 * rewritten — so a filter on the surviving tag has to reach them through the merge. Kept per
 * requested tag, because a mission must carry each one. A tag that does not exist has no entry.
 */
export async function tagClosure(
  db: Db,
  tagIds: readonly string[] | undefined,
): Promise<Map<string, string[]>> {
  const reach = new Map<string, string[]>();
  if (tagIds === undefined || tagIds.length === 0) return reach;
  const ids = sql.join(
    [...new Set(tagIds)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    WITH RECURSIVE merged AS (
      SELECT id AS root, id FROM tags WHERE id IN (${ids})
      UNION
      SELECT m.root, t.id FROM tags t JOIN merged m ON t.merged_into_id = m.id
    )
    SELECT root, id FROM merged`)) as unknown as Array<{ root: string; id: string }>;
  for (const r of rows) reach.set(r.root, [...(reach.get(r.root) ?? []), r.id]);
  return reach;
}
