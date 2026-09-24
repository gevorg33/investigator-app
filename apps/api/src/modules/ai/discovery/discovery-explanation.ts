import type {
  MatchedOnView,
  NodeLabel,
  NotMatchedView,
} from '../tools/discovery/discovery.schemas';

/**
 * One reason an investigator is, or is not quite, a match — as data for the client to phrase in
 * the reader's language (`investigator-discovery`).
 */
export type MatchReason =
  | { code: 'matched.specialty'; specialties: NodeLabel[] }
  | { code: 'matched.languages'; languages: string[] }
  | { code: 'matched.place'; place: NonNullable<MatchedOnView['place']> }
  | { code: 'matched.distance'; km: number }
  | { code: 'matched.availability'; window: NonNullable<MatchedOnView['availability']> }
  | { code: 'not_matched.specialty'; specialties: NodeLabel[] };

/**
 * Why this investigator matches, rendered from `matchedOn`, `notMatched` and the distance — and
 * from nothing else, because nothing else is passed in. There is no profile here to embellish
 * from: no bio, no price, no declared hours beyond the window asked for. A reason that is not in
 * the data cannot be rendered, which is the guarantee the assistant gives.
 *
 * A gap is stated, not omitted: "matches on specialty and language, but does not offer
 * surveillance" is the honest answer.
 */
export function explainMatch(match: {
  matchedOn: MatchedOnView;
  notMatched: NotMatchedView;
  distanceKm: number | null;
}): MatchReason[] {
  const { matchedOn, notMatched, distanceKm } = match;
  const reasons: MatchReason[] = [];
  if (matchedOn.taxonomy.length > 0) {
    reasons.push({ code: 'matched.specialty', specialties: matchedOn.taxonomy });
  }
  if (matchedOn.languages.length > 0) {
    reasons.push({ code: 'matched.languages', languages: matchedOn.languages });
  }
  if (matchedOn.place !== null) reasons.push({ code: 'matched.place', place: matchedOn.place });
  if (distanceKm !== null) reasons.push({ code: 'matched.distance', km: distanceKm });
  if (matchedOn.availability !== null) {
    reasons.push({ code: 'matched.availability', window: matchedOn.availability });
  }
  if (notMatched.taxonomy.length > 0) {
    reasons.push({ code: 'not_matched.specialty', specialties: notMatched.taxonomy });
  }
  return reasons;
}
