import type { MissionStatus, OwnMission, TagOption } from '@/lib/api/types';
import type { Named } from '@/lib/taxonomy';

/** The API's limit on a mission's tags (`MAX_MISSION_TAGS`, tag-rules.ts). */
export const MAX_MISSION_TAGS = 8;

/**
 * The names of a mission's tags (T-055), in the order given, from the vocabulary the reader was
 * offered. A tag retired since is not offered, and is left out rather than shown by its id.
 */
export const tagNames = (ids: readonly string[], options: readonly TagOption[]): Named[] =>
  ids.flatMap((id) => {
    const option = options.find((o) => o.id === id);
    return option === undefined ? [] : [{ label: option.label, lang: option.labelLocale }];
  });

/** Whether each status comes only after a moderator published the mission (T-051). */
const AFTER_PUBLICATION: Record<MissionStatus, boolean> = {
  DRAFT: false,
  SUBMITTED: false,
  UNDER_REVIEW: false,
  QUOTED: true,
  CUSTOMER_CONFIRMED: true,
  PAID: true,
  ASSIGNED: true,
  ACCEPTED: true,
  IN_PROGRESS: true,
  REPORT_SUBMITTED: true,
  CUSTOMER_REVIEW: true,
  COMPLETED: true,
  DISPUTED: true,
  SUSPENDED: true,
  EXPIRED: true,
  CANCELLED: false,
  REJECTED: false,
};

/**
 * The tags to show the customer on their mission (T-194). Once it is published, the ones it was
 * published with — what investigators find it under, which a moderator may have changed. Before
 * then, their own suggestions. A cancelled mission counts as published if it carries confirmed
 * tags; one cancelled after publishing with none shows the suggestions, labelled as such.
 */
export const shownTags = (mission: OwnMission): { ids: string[]; published: boolean } =>
  AFTER_PUBLICATION[mission.status] || mission.confirmedTagIds.length > 0
    ? { ids: mission.confirmedTagIds, published: true }
    : { ids: mission.tagIds, published: false };
