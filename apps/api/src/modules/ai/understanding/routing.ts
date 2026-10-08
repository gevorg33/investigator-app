/**
 * Structural routing (T-220, P-9; AI-EXECUTION-PLAN §4): what a message is, decided from its shape
 * and the conversation's state — never by choosing an action from its words.
 *
 * - **Empty**, once normalized — invisible characters alone pass a "not blank" check — or **too
 *   long**: refused before anything is stored.
 * - **A yes while a plan waits** — "confirm", "подтверждаю", "այո", alone — is pointed at the plan's
 *   own Confirm control and confirms nothing. (A yes shorter than the turn's three characters, "да"
 *   or "ok", is never sent at all: the composer and `AskTurnDto` hold the same bound.) Confirming
 *   is a person's authenticated request for exactly the plan they were shown (T-048); words in a
 *   conversation never are one.
 * - **Everything else** goes on to be answered. The answer to discovery's own question is told apart
 *   by the client (`clarifies`, T-059), not here.
 */

/** The same bound as the turn's own (`AskTurnDto`). */
export const MIN_LENGTH = 3;
export const MAX_LENGTH = 2000;

export type Route =
  | { route: 'empty' }
  | { route: 'too_long' }
  | { route: 'confirm_pointer'; planId: string }
  | { route: 'ask' };

/**
 * A message that is only a yes, in each language the platform speaks. Whole messages only: "yes,
 * but invite Davit too" is a new request, and goes to be answered.
 */
const AFFIRMATIONS = new Set([
  'yes',
  'yes please',
  'yep',
  'yeah',
  'ok',
  'okay',
  'sure',
  'confirm',
  'confirmed',
  'i confirm',
  'approve',
  'approved',
  'go ahead',
  'do it',
  'да',
  'ага',
  'ок',
  'хорошо',
  'давай',
  'делай',
  'подтверждаю',
  'подтвердить',
  'согласен',
  'согласна',
  'այո',
  'հա',
  'լավ',
  'օկ',
  'հաստատում եմ',
  'հաստատել',
  'արա',
  'համաձայն եմ',
]);

/** A message reduced to its words: lower case, without punctuation, symbols or emoji. */
const bare = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function isAffirmation(text: string): boolean {
  return AFFIRMATIONS.has(bare(text));
}

/**
 * Where a message goes. `text` is normalized (`normalizeText`); `waiting` is the id of a plan in the
 * conversation still waiting for the person's answer, if there is one.
 */
export function routeMessage(
  text: string,
  state: { waiting: string | null; clarifies: boolean },
): Route {
  if ([...text].length < MIN_LENGTH) return { route: 'empty' };
  if ([...text].length > MAX_LENGTH) return { route: 'too_long' };
  if (!state.clarifies && state.waiting !== null && isAffirmation(text)) {
    return { route: 'confirm_pointer', planId: state.waiting };
  }
  return { route: 'ask' };
}
