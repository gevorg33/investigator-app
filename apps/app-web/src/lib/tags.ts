import type { TagOption } from '@/lib/api/types';

/** The API's limit on a mission's tags (`MAX_MISSION_TAGS`, tag-rules.ts). */
export const MAX_MISSION_TAGS = 8;

/**
 * The names of a mission's tags (T-055), in the order given, from the vocabulary the reader was
 * offered. A tag retired since is not offered, and is left out rather than shown by its id.
 */
export const tagNames = (ids: readonly string[], options: readonly TagOption[]): string[] =>
  ids.flatMap((id) => {
    const option = options.find((o) => o.id === id);
    return option === undefined ? [] : [option.label];
  });
