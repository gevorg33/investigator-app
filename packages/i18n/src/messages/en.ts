/**
 * English — the source catalog. Every other locale must have exactly these keys, with the same
 * ICU arguments (a type error, and a test, when it does not).
 *
 * Keys follow `domain.screen.element.state`, grouped by domain (localization skill). Plurals and
 * variables are ICU MessageFormat: `{count, plural, one {# quote} other {# quotes}}` — never a
 * concatenated sentence.
 */
export const en = {
  app: {
    name: 'Investigator',
  },
  shell: {
    skip_to_content: 'Skip to content',
    nav: {
      label: 'Primary',
    },
  },
  nav: {
    home: 'Home',
    missions: 'Missions',
    messages: 'Messages',
    assistant: 'Assistant',
    account: 'Account',
  },
  home: {
    empty: {
      title: 'Nothing needs you yet',
      body: 'Quotes to review, new messages and assignment updates will be gathered here as they arrive.',
    },
  },
  missions: {
    empty: {
      title: 'No missions yet',
      body: 'Missions you create, or work on as an investigator, will be listed here.',
    },
  },
  messages: {
    empty: {
      title: 'No conversations yet',
      body: 'Conversations with investigators and customers about a mission will appear here.',
    },
  },
  assistant: {
    empty: {
      title: 'The assistant is on its way',
      body: 'Ask how the platform works, or describe what you need and it will find investigators who match.',
    },
  },
  account: {
    empty: {
      title: 'Your account',
      body: 'Your profile, sign-in and privacy settings will be managed here.',
    },
    language: {
      title: 'Language',
      body: 'The language the platform uses for you. Until you choose, it follows your browser.',
    },
  },
} as const;
