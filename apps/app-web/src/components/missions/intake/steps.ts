import type { MissionFields, SubjectRelationship } from '@/lib/api/types';

/**
 * The intake's questions (T-119), one per screen on a phone, in the order a person thinks of them:
 * what they need, what kind of help that is, where, by when, for how much, in which languages, who
 * it concerns and why. The last screen is the brief itself, confirmed and sent.
 *
 * Each step owns the draft fields it asks for, so an error the API reports on a field can send the
 * customer back to the one screen that fixes it.
 */
export const STEPS = [
  'need',
  'kind',
  'where',
  'when',
  'budget',
  'languages',
  'who',
  'why',
  'review',
] as const;

export type Step = (typeof STEPS)[number];

/** The lawful-use policy in the help centre — what cannot be requested, and why. */
export const POLICY_HREF = '/help/kb-policy-prohibited-requests';

/** Draft fields by the step that asks for them. The review step asks for none. */
const FIELDS: Readonly<Record<Exclude<Step, 'review'>, readonly (keyof MissionFields)[]>> = {
  need: ['title', 'description'],
  kind: ['taxonomyNodeId'],
  where: ['countryCode', 'locationLabel'],
  when: ['deadline', 'startBy'],
  budget: ['currency', 'budgetMinMinor', 'budgetMaxMinor'],
  languages: ['languages'],
  who: ['subjectRelationship', 'protectiveOrderDeclared'],
  why: ['purpose'],
};

/**
 * Relationships where a protective order decides whether the work is supportable, so the intake
 * asks about one. The API holds the same list (`PERSONAL_RELATIONSHIPS`) and refuses a submission
 * without the answer; asking here is so the customer is not told only at the end.
 */
export const PERSONAL: ReadonlySet<SubjectRelationship> = new Set([
  'FAMILY_MEMBER',
  'PARTNER_OR_SPOUSE',
  'FORMER_PARTNER',
]);

export const RELATIONSHIPS: readonly SubjectRelationship[] = [
  'SELF_OR_OWN_ORGANISATION',
  'EMPLOYER',
  'BUSINESS_RELATIONSHIP',
  'LEGAL_REPRESENTATIVE',
  'FAMILY_MEMBER',
  'PARTNER_OR_SPOUSE',
  'FORMER_PARTNER',
  'NO_PERSONAL_RELATIONSHIP',
  'OTHER',
];

export const isStep = (value: string | undefined): value is Step => STEPS.some((s) => s === value);

/** The step that asks for a field, or none for a field the intake does not ask about. */
export function stepOf(field: string): Exclude<Step, 'review'> | undefined {
  return (Object.keys(FIELDS) as Exclude<Step, 'review'>[]).find((step) =>
    (FIELDS[step] as readonly string[]).includes(field),
  );
}

const blank = (v: string | null) => v === null || v.trim() === '';

/**
 * The fields a step still needs before the mission can be sent — the API's submission rules
 * (`REQUIRED_AT_SUBMISSION`), asked one screen at a time. Optional fields never appear here.
 */
export function missing(step: Step, d: MissionFields): (keyof MissionFields)[] {
  const out: (keyof MissionFields)[] = [];
  const need = (field: keyof MissionFields, gap: boolean) => {
    if (gap) out.push(field);
  };
  switch (step) {
    case 'need':
      need('title', blank(d.title));
      need('description', blank(d.description));
      break;
    case 'kind':
      need('taxonomyNodeId', d.taxonomyNodeId === null);
      break;
    case 'where':
      need('countryCode', d.countryCode === null);
      break;
    case 'when':
      need('deadline', d.deadline === null);
      break;
    case 'budget':
      need('currency', d.currency === null);
      need('budgetMinMinor', d.budgetMinMinor === null);
      need('budgetMaxMinor', d.budgetMaxMinor === null);
      break;
    case 'languages':
      need('languages', d.languages.length === 0);
      break;
    case 'who':
      need('subjectRelationship', d.subjectRelationship === null);
      need(
        'protectiveOrderDeclared',
        d.subjectRelationship !== null &&
          PERSONAL.has(d.subjectRelationship) &&
          d.protectiveOrderDeclared === null,
      );
      break;
    case 'why':
      need('purpose', blank(d.purpose));
      break;
    case 'review':
      break;
  }
  return out;
}

/** Where a customer picks up a draft: the first question not yet answered, else the brief. */
export function resumeAt(d: MissionFields): Step {
  return STEPS.find((s) => missing(s, d).length > 0) ?? 'review';
}

/** Today as a calendar date in the reader's own day, for a date input's `min`. */
export function today(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
