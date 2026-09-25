import { sql } from 'drizzle-orm';
import type { Db } from '../../database/database.module';

/**
 * Each requested taxonomy node, with its descendants and its ancestors.
 *
 * Both directions, because ADR-0007 says matching walks the tree from either side: a
 * customer asking about `corporate` reaches an investigator who declared
 * `corporate/due-diligence`, and one asking about `corporate/due-diligence` reaches an
 * investigator who declared `corporate`.
 *
 * Kept per requested node rather than merged, so a result can say which of several requested
 * specialties it does not cover (`notMatched`). Shared by investigator discovery and mission
 * browse (T-054), so both walk the tree the same way. A node that does not exist has no entry.
 */
export async function taxonomyClosure(
  db: Db,
  nodeIds: readonly string[] | undefined,
): Promise<Map<string, string[]>> {
  const reach = new Map<string, string[]>();
  if (nodeIds === undefined || nodeIds.length === 0) return reach;
  const ids = sql.join(
    [...new Set(nodeIds)].map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = (await db.execute(sql`
    WITH RECURSIVE requested AS (
      SELECT id AS root, id, parent_id FROM taxonomy_nodes WHERE id IN (${ids})
    ),
    down AS (
      SELECT root, id, parent_id FROM requested
      UNION
      SELECT d.root, t.id, t.parent_id FROM taxonomy_nodes t JOIN down d ON t.parent_id = d.id
    ),
    up AS (
      SELECT root, id, parent_id FROM requested
      UNION
      SELECT a.root, t.id, t.parent_id FROM taxonomy_nodes t JOIN up a ON a.parent_id = t.id
    )
    SELECT root, id FROM down UNION SELECT root, id FROM up`)) as unknown as Array<{
    root: string;
    id: string;
  }>;
  for (const r of rows) reach.set(r.root, [...(reach.get(r.root) ?? []), r.id]);
  return reach;
}
