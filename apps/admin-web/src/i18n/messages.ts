/**
 * The staff console's strings, by key (localization skill: keys only, never a literal in a
 * component). English only for now; the keys are the contract that carries over when catalogs
 * arrive, as in app-web.
 */
export const LOCALE = 'en';

const en = {
  'app.name': 'Investigator Staff',
  'home.title': 'Staff console',
  'home.body':
    'Verification, moderation and support queues will be worked here. Staff sign-in opens with the verification console.',
  'home.sign_in': 'Sign in',
} as const;

export type MessageKey = keyof typeof en;

/** The string for a key. A key that does not exist is a type error, not a raw key on screen. */
export const t = (key: MessageKey): string => en[key];
