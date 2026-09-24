import { missionScreeningOutcome, riskBand, subjectRelationship } from '../../database/schema';
import {
  RULESET_VERSION,
  STRUCTURED_FLAGS,
  TEXT_RULES,
  type TextRule,
} from './mission-policy.rules';

export type RiskBandValue = (typeof riskBand.enumValues)[number];
export type SubjectRelationshipValue = (typeof subjectRelationship.enumValues)[number];
export type ScreeningOutcome = (typeof missionScreeningOutcome.enumValues)[number];

/** Least to most sensitive — the enum's own order, so the two cannot disagree. */
export const RISK_BANDS: readonly RiskBandValue[] = riskBand.enumValues;

/** Relationships in which the customer is asked about a protective order. */
export const PERSONAL_RELATIONSHIPS: ReadonlySet<SubjectRelationshipValue> = new Set([
  'FAMILY_MEMBER',
  'PARTNER_OR_SPOUSE',
  'FORMER_PARTNER',
]);

const PARTNER_RELATIONSHIPS: ReadonlySet<SubjectRelationshipValue> = new Set([
  'PARTNER_OR_SPOUSE',
  'FORMER_PARTNER',
]);

export interface ScreeningInput {
  title: string | null;
  description: string | null;
  purpose: string | null;
  locationLabel: string | null;
  subjectRelationship: SubjectRelationshipValue | null;
  protectiveOrderDeclared: boolean | null;
  /** The taxonomy node's band. Null when the node has not been banded yet. */
  categoryBand: RiskBandValue | null;
}

export interface ScreeningResult {
  rulesetVersion: string;
  outcome: ScreeningOutcome;
  riskBand: RiskBandValue;
  flags: string[];
}

/**
 * Folds the ways the same words can be written differently into one form: compatibility
 * characters, case, invisible characters that split a word without showing, curly
 * apostrophes, and ё/е. Spacing is collapsed so a line break cannot split a phrase.
 *
 * Not an evasion defence — "h a c k" still passes. Nothing here has to be one: a mission the
 * rules miss is still read by a moderator.
 */
/** Zero-width and formatting characters: they split a word without showing that they did. */
const INVISIBLE = new RegExp('[\\u00AD\\u200B-\\u200F\\u2060\\uFEFF]', 'g');

/** Curly and modifier apostrophes, folded to the straight one the rules are written with. */
const APOSTROPHES = new RegExp('[\\u2018\\u2019\\u02BC`]', 'g');

export function normaliseForScreening(text: string): string {
  return (
    text
      .normalize('NFKC')
      .toLowerCase()
      // Built from escapes rather than written as a literal class: formatting turns the escapes
      // into the characters themselves, and a soft hyphen sitting invisibly in the source is
      // both a lint error and unreviewable.
      .replace(INVISIBLE, '')
      .replace(APOSTROPHES, "'")
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
  );
}

/**
 * The prohibited-request rules this text trips, normalised first. One detector for every surface
 * that screens text: a mission when it is submitted, and a request to the assistant to find an
 * investigator (T-018). Two copies of the phrase list would drift, and the one nobody updated is
 * the one a request would slip through.
 */
export function matchingTextRules(text: string): TextRule[] {
  const normalised = normaliseForScreening(text);
  return TEXT_RULES.filter((rule) => rule.patterns.some((p) => p.test(normalised)));
}

const higher = (a: RiskBandValue, b: RiskBandValue): RiskBandValue =>
  RISK_BANDS.indexOf(b) > RISK_BANDS.indexOf(a) ? b : a;

/**
 * Screens one submission. Pure: no I/O, no clock, no model.
 *
 * It takes no AI classification, and that is the enforcement of "AI may classify but never
 * decide" — not a convention a later edit could quietly drop, but a signature with nowhere to
 * put one. The classification is stored beside this result by MissionPolicyService.
 */
export function screenMission(input: ScreeningInput): ScreeningResult {
  const flags: string[] = [];
  let band: RiskBandValue = input.categoryBand ?? STRUCTURED_FLAGS.categoryUnbanded.raisesTo;

  const raise = (flag: { id: string; raisesTo: RiskBandValue }) => {
    flags.push(flag.id);
    band = higher(band, flag.raisesTo);
  };

  if (input.categoryBand === null) raise(STRUCTURED_FLAGS.categoryUnbanded);
  if (input.subjectRelationship !== null && PARTNER_RELATIONSHIPS.has(input.subjectRelationship)) {
    raise(STRUCTURED_FLAGS.partnerInvestigation);
  }
  if (input.protectiveOrderDeclared === true) raise(STRUCTURED_FLAGS.protectiveOrderDeclared);

  const text = [input.title, input.description, input.purpose, input.locationLabel]
    .filter((s) => s !== null)
    .join('\n');
  for (const rule of matchingTextRules(text)) raise(rule);

  const outcome: ScreeningOutcome =
    flags.length > 0 || RISK_BANDS.indexOf(band) >= RISK_BANDS.indexOf('HIGH')
      ? 'PRIORITY_REVIEW'
      : 'ROUTINE_REVIEW';

  return { rulesetVersion: RULESET_VERSION, outcome, riskBand: band, flags };
}
