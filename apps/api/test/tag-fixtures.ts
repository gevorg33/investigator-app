import { randomUUID } from 'node:crypto';
import type { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/database/schema';

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A tag in the curated vocabulary (T-055), with an English label unless a test says otherwise.
 * Written as the owner: staff write tags through TagsService, which tags.service.spec.ts tests.
 */
export async function tag(
  db: TestDb,
  opts: {
    labels?: Partial<Record<'en' | 'ru' | 'hy', string>>;
    status?: 'ACTIVE' | 'DEPRECATED';
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.tags)
    .values({ slug: `tag-${randomUUID()}`, status: opts.status ?? 'ACTIVE' })
    .returning();
  const labels = opts.labels ?? { en: 'Test tag' };
  for (const [locale, label] of Object.entries(labels)) {
    await db.insert(schema.tagLabels).values({ tagId: row!.id, locale: locale as 'en', label });
  }
  return row!.id;
}

/**
 * A tag a moderator confirmed on a mission, as publishing it would leave it — for browse tests,
 * whose subject is reading confirmed tags, not the confirming.
 */
export async function confirmedTag(
  db: TestDb,
  opts: { missionId: string; tagId: string; confirmedBy?: string },
): Promise<void> {
  await db.insert(schema.missionTags).values({
    missionId: opts.missionId,
    tagId: opts.tagId,
    confirmedAt: new Date(),
    confirmedBy: opts.confirmedBy ?? randomUUID(),
  });
}
