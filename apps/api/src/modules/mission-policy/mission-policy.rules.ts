import type { RiskBandValue } from './mission-screening';

/**
 * The deterministic mission policy ruleset.
 *
 * Rules FLAG; they never decide. A match raises the mission's band and moves it up the
 * moderation queue, and a moderator reads it. A miss publishes nothing — every mission is
 * reviewed (docs/knowledge-base/staff/mission-policy-review.en.md). That asymmetry is what
 * makes a phrase list acceptable here: a false positive costs a moderator a minute, and a
 * false negative still reaches a person.
 *
 * Deterministic means the same text and the same ruleset version always produce the same
 * flags, with no model and no randomness — so a screening result can be explained, months
 * later, from its stored `ruleset_version` alone. **Change a rule, bump the version.**
 *
 * Patterns cover English and Russian. Armenian is not yet covered and needs a native speaker
 * with domain knowledge rather than a guess (T-067); an Armenian mission is still reviewed,
 * it just is not prioritised by text.
 *
 * The categories follow the prohibited list in
 * docs/knowledge-base/policies/prohibited-requests.en.md. That document is the policy; this
 * file is a detector for it, and the detector is deliberately narrower than the policy.
 */
export const RULESET_VERSION = '2026-09-14.1';

export interface TextRule {
  /** Stable id. Stored in `mission_screenings.flags`, so renaming one is a ruleset change. */
  id: string;
  raisesTo: RiskBandValue;
  patterns: readonly RegExp[];
}

// Text is normalised before matching (see `normaliseForScreening`): lower case, NFKC, straight
// apostrophes, ё folded to е. Patterns are written against that form.
//
// `\b` does not understand Cyrillic, so boundaries are letter/digit lookarounds instead.
const phrase = (source: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'u');

/**
 * Somebody else's: "his", "her", "their", "someone's", "my wife's". Not "my" alone — a
 * customer asking about their own accounts is not making a prohibited request.
 *
 * The `my <person>'s` branch is needed on its own: "read my wife's messages" is how these
 * requests are actually worded, and a possessive alone does not match it.
 */
const THEIRS = String.raw`(?:his|her|their|someone's|my \p{L}+'s|\p{L}+'s)`;
const THEIRS_RU = String.raw`(?:его|ее|их|чужо\p{L}*)`;

export const TEXT_RULES: readonly TextRule[] = [
  {
    id: 'device_or_account_access',
    raisesTo: 'HIGH',
    patterns: [
      // Bounded rather than `hack\p{L}*`, which matched "hackathon" — a due-diligence mission
      // about a hackathon sponsor is not an account-access request.
      phrase(String.raw`hack(?:s|ed|ing|er|ers)?`),
      phrase(
        String.raw`(?:access|get into|break into|log ?in(?:to)?|login to|unlock) ${THEIRS} (?:phone|mobile|email|e-mail|inbox|accounts?|icloud|whatsapp|telegram|instagram|facebook|computer|laptop|device|messages|texts|chats)`,
      ),
      phrase(String.raw`${THEIRS} (?:passwords?|passcodes?|pin codes?)`),
      phrase(String.raw`read ${THEIRS} (?:messages|texts|emails|e-mails|chats|dms)`),
      phrase(String.raw`взлом\p{L}*`),
      phrase(String.raw`(?:узнать|получить|подобрать) пароль\p{L}*`),
      phrase(
        String.raw`доступ к ${THEIRS_RU} (?:телефону|почте|аккаунт\p{L}*|переписке|компьютеру|ноутбуку|сообщениям)`,
      ),
      phrase(String.raw`прочита\p{L}* ${THEIRS_RU} (?:переписку|сообщения|смс|почту)`),
    ],
  },
  {
    id: 'covert_monitoring_software',
    raisesTo: 'HIGH',
    patterns: [
      phrase(
        String.raw`spyware|stalkerware|key ?loggers?|spy (?:apps?|software)|monitoring (?:apps?|software)`,
      ),
      phrase(
        String.raw`install (?:an? |some )?(?:app|application|software|program) on ${THEIRS} (?:phone|computer|laptop|device)`,
      ),
      phrase(String.raw`шпионск\p{L}* (?:программ|приложени|по)\p{L}*`),
      phrase(String.raw`кейлоггер\p{L}*`),
      phrase(
        String.raw`установить (?:программу|приложение) на ${THEIRS_RU} (?:телефон|компьютер|ноутбук)`,
      ),
    ],
  },
  {
    id: 'tracking_device',
    raisesTo: 'HIGH',
    patterns: [
      phrase(String.raw`gps trackers?|tracking devices?|air ?tags?`),
      phrase(String.raw`(?:put|place|attach|hide|install) (?:a |an )?(?:gps |hidden )?trackers?`),
      phrase(String.raw`trackers? on ${THEIRS} (?:car|vehicle|bag|phone|bike)`),
      phrase(String.raw`gps[- ]?трекер\p{L}*|трекер\p{L}*|маяч\p{L}*|жуч\p{L}*`),
    ],
  },
  {
    id: 'interception',
    raisesTo: 'HIGH',
    patterns: [
      phrase(String.raw`wire ?tap\p{L}*|intercept\p{L}*`),
      phrase(
        String.raw`(?:listen to|record|tap) ${THEIRS} (?:calls|phone calls|phone|conversations)`,
      ),
      phrase(String.raw`bug ${THEIRS} (?:phone|house|home|room|car|office)`),
      phrase(String.raw`прослуш\p{L}*|перехват\p{L}*`),
    ],
  },
  {
    id: 'protected_records',
    raisesTo: 'HIGH',
    patterns: [
      phrase(
        String.raw`(?:phone|call|telephone|mobile|cell) records|call (?:logs|history|detail records)`,
      ),
      phrase(
        String.raw`bank (?:statements|records|account details|transactions)|medical (?:records|history)|health records`,
      ),
      phrase(String.raw`(?:детализаци|распечатк)\p{L}* звонков`),
      phrase(
        String.raw`банковск\p{L}* выписк\p{L}*|медицинск\p{L}* (?:карт|документ|запис)\p{L}*|истори\p{L}* болезни`,
      ),
    ],
  },
  {
    id: 'impersonation_or_pretext',
    raisesTo: 'HIGH',
    patterns: [
      phrase(
        String.raw`pretext\p{L}*|impersonat\p{L}*|pos(?:e|ing) as|pretend(?:ing)? to be|catfish\p{L}*`,
      ),
      phrase(String.raw`fake (?:profiles?|identity|identities|accounts?)`),
      phrase(
        String.raw`выда\p{L}* себя за|представи\p{L}* (?:сотрудником|полицейским|врачом|курьером)`,
      ),
      phrase(String.raw`фейков\p{L}* (?:аккаунт|профил|страниц)\p{L}*`),
    ],
  },
  {
    id: 'open_ended_monitoring',
    raisesTo: 'HIGH',
    patterns: [
      phrase(
        String.raw`24/7|(?:round|around) the clock|indefinitely|at all times|every (?:move|movement)`,
      ),
      phrase(String.raw`(?:ongoing|constant|continuous|permanent) (?:monitoring|surveillance)`),
      phrase(String.raw`круглосуточн\p{L}*|постоянн\p{L}* (?:слежк|наблюдени|контрол)\p{L}*`),
      phrase(String.raw`кажд\p{L}* ${THEIRS_RU} шаг\p{L}*`),
    ],
  },
  {
    id: 'harassment_or_intimidation',
    raisesTo: 'HIGH',
    patterns: [
      phrase(String.raw`harass\p{L}*|intimidat\p{L}*|blackmail\p{L}*|revenge`),
      phrase(
        String.raw`(?:teach (?:him|her|them) a lesson|scare (?:him|her|them)|make (?:him|her|them) pay)`,
      ),
      phrase(String.raw`запуга\p{L}*|отомст\p{L}*|месть|шантаж\p{L}*|проучить`),
    ],
  },
  {
    id: 'unlawful_entry',
    raisesTo: 'HIGH',
    patterns: [
      phrase(
        String.raw`(?:break|get|sneak) into ${THEIRS} (?:house|home|flat|apartment|office|property)`,
      ),
      phrase(String.raw`enter ${THEIRS} (?:house|home|flat|apartment|property) without`),
      phrase(String.raw`проник\p{L}* в ${THEIRS_RU} (?:дом|квартиру|офис)`),
    ],
  },
];

/**
 * Structured answers that always need a moderator's attention first. Not accusations: partner
 * investigation is in scope (ADR-0009) — and moderated every time, as RESTRICTED.
 */
export const STRUCTURED_FLAGS = {
  partnerInvestigation: { id: 'partner_investigation', raisesTo: 'RESTRICTED' },
  protectiveOrderDeclared: { id: 'protective_order_declared', raisesTo: 'RESTRICTED' },
  categoryUnbanded: { id: 'category_unbanded', raisesTo: 'HIGH' },
} as const satisfies Record<string, { id: string; raisesTo: RiskBandValue }>;
