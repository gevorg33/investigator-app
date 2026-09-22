import * as schema from '../src/database/schema';
import type { TestDb } from './mission-fixtures';

/**
 * A conversation with the assistant, owned by `userId` in `tenantId` (T-045).
 *
 * Written as the owner, so the workspace and user are given rather than read from a context.
 * Messages have no factory on purpose: only the session service numbers them, under a lock, and
 * a fixture that wrote them directly would be testing a sequence nothing in the product makes.
 */
export async function aiSession(
  db: TestDb,
  input: { tenantId: string; userId: string; title?: string | null; archivedAt?: Date | null },
): Promise<typeof schema.aiSessions.$inferSelect> {
  const [row] = await db
    .insert(schema.aiSessions)
    .values({
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title === undefined ? 'A conversation' : input.title,
      archivedAt: input.archivedAt ?? null,
      lastActivityAt: new Date(),
    })
    .returning();
  return row!;
}
