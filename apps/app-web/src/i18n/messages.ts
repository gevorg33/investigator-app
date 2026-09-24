/**
 * The shell's strings, by key (localization skill: keys only, never a literal in a component).
 *
 * English only, and deliberately small: T-128 brings the en/ru/hy catalogs and the parity check,
 * and replaces this module. The keys are the contract that carries over — screens written
 * against `t('nav.missions')` today need no change when the catalogs arrive.
 */
export const LOCALE = 'en';

const en = {
  'app.name': 'Investigator',
  'shell.skip_to_content': 'Skip to content',
  'shell.nav.label': 'Primary',
  'nav.home': 'Home',
  'nav.missions': 'Missions',
  'nav.messages': 'Messages',
  'nav.assistant': 'Assistant',
  'nav.account': 'Account',
  'home.empty.title': 'Nothing needs you yet',
  'home.empty.body':
    'Quotes to review, new messages and assignment updates will be gathered here as they arrive.',
  'missions.empty.title': 'No missions yet',
  'missions.empty.body': 'Missions you create, or work on as an investigator, will be listed here.',
  'messages.empty.title': 'No conversations yet',
  'messages.empty.body':
    'Conversations with investigators and customers about a mission will appear here.',
  'assistant.empty.title': 'The assistant is on its way',
  'assistant.empty.body':
    'Ask how the platform works, or describe what you need and it will find investigators who match.',
  'account.empty.title': 'Your account',
  'account.empty.body': 'Your profile, sign-in and privacy settings will be managed here.',
} as const;

export type MessageKey = keyof typeof en;

/** The string for a key. A key that does not exist is a type error, not a raw key on screen. */
export const t = (key: MessageKey): string => en[key];
