import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { missions } from './missions';
import { missionTags, tagLabels, tags } from './tags';

const fks = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((f) => ({
    column: f.reference().columns[0]?.name,
    target: f.reference().foreignTable,
    onDelete: f.onDelete,
  }));

/**
 * What tags are attached to, and what deleting does (T-055). Nothing: the vocabulary is retired
 * or merged, never deleted, and a mission's tags go only with the mission's own retention.
 */
describe('tags and what they hang from', () => {
  it('keeps a merged tag and every label while the tag exists', () => {
    expect(fks(tags)).toEqual([{ column: 'merged_into_id', target: tags, onDelete: 'restrict' }]);
    expect(fks(tagLabels)).toEqual([{ column: 'tag_id', target: tags, onDelete: 'restrict' }]);
  });

  it('holds a mission’s tags against the mission or the tag being removed', () => {
    expect(fks(missionTags)).toEqual(
      expect.arrayContaining([
        { column: 'mission_id', target: missions, onDelete: 'restrict' },
        { column: 'tag_id', target: tags, onDelete: 'restrict' },
      ]),
    );
  });

  it('indexes what the reads ask: a tag’s merges, a tag’s missions, a workspace’s missions', () => {
    expect(
      getTableConfig(tags)
        .indexes.map((i) => i.config.name)
        .sort(),
    ).toEqual(['tags_merged_into_idx', 'tags_slug_unique']);
    expect(
      getTableConfig(missionTags)
        .indexes.map((i) => i.config.name)
        .sort(),
    ).toEqual(['mission_tags_tag_idx', 'mission_tags_tenant_mission_idx']);
  });
});
