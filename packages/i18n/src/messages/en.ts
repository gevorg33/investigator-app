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
    unverified: 'Confirm your email address — we sent you a link.',
    outstanding: 'Some documents need your acceptance.',
    review: 'Review',
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
    profile: {
      title: 'Your details',
      email: 'Email',
      verified: 'Confirmed',
      unverified: 'Not confirmed yet',
      resend: 'Send the confirmation link again',
      resent: 'A new confirmation link is on its way.',
    },
    language: {
      title: 'Language',
      body: 'The language the platform uses for you. Until you choose, it follows your browser.',
    },
    timezone: {
      title: 'Time zone',
      body: 'Dates and times are shown in this time zone.',
      current: 'Now showing times in {zone}.',
      detected: 'Your device is set to {zone}.',
      use_detected: 'Use {zone}',
      choose: 'Time zone',
      save: 'Save time zone',
      saved: 'Time zone saved.',
    },
    roles: {
      title: 'How you use the platform',
      customer: 'Hiring investigators',
      investigator: 'Working as an investigator',
      add_customer: 'Also hire investigators',
      add_investigator: 'Also work as an investigator',
      accept_first: 'To add this, read and accept:',
      accept: 'I have read and accept these documents',
      add_submit: 'Add',
      acting_as: 'Show the platform as',
      act_both: 'Both',
      act_customer: 'Customer',
      act_investigator: 'Investigator',
      verify_first: 'Confirm your email address first — then you can add this.',
    },
    sessions: {
      title: 'Where you are signed in',
      this_device: 'This device',
      device: '{browser} on {os}',
      unknown_device: 'Unknown device',
      last_used: 'Last used {when}',
      signed_in: 'Signed in on {date}',
      sign_out_other: 'Sign out',
      sign_out_here: 'Sign out on this device',
    },
    legal: {
      title: 'Documents to accept',
      body: 'A new version of these documents is in force. Read and accept them to keep using the parts of the platform they cover.',
      accept: 'I have read and accept these documents',
      submit: 'Accept',
    },
  },

  auth: {
    email: 'Email',
    password: 'Password',
    password_hint: 'At least 12 characters.',
    sign_in: {
      title: 'Sign in',
      submit: 'Sign in',
      failed: 'The email address or password is not right.',
      forgot: 'Forgot your password?',
      new_here: 'New here?',
      create_account: 'Create an account',
      reset_done: 'Your password has been changed. Sign in with the new one.',
      verified: 'Your email address is confirmed. Sign in to continue.',
    },
    sign_up: {
      title: 'Create your account',
      submit: 'Create account',
      accept_intro: 'Read before you continue:',
      accept: 'I have read and accept these documents',
      shown_in: 'Shown in {language}: not yet translated into your language.',
      have_account: 'Already have an account?',
      sign_in: 'Sign in',
    },
    check_email: {
      title: 'Check your email',
      body: 'If this address can be used, a link is on its way to it. It works once and expires, and can take a few minutes to arrive.',
      resend_title: 'Nothing arrived?',
      resend_submit: 'Send the link again',
      resent: 'If this address can be used, a new link is on its way.',
    },
    verify: {
      title: 'Confirm your email address',
      body: 'Confirm that this address is yours to finish setting up your account.',
      submit: 'Confirm my email address',
      done: 'Your email address is confirmed.',
      continue: 'Continue',
      invalid: 'This link has expired or has already been used. Ask for a new one.',
      missing: 'This link is incomplete. Open it again from your email, or ask for a new one.',
      request_new: 'Ask for a new link',
    },
    forgot: {
      title: 'Reset your password',
      body: 'Enter the email address you signed up with. If it has an account, a link to choose a new password is on its way.',
      submit: 'Send the link',
      sent: 'If an account uses this address, a link to reset its password is on its way.',
      back: 'Back to sign in',
    },
    reset: {
      title: 'Choose a new password',
      password: 'New password',
      confirm: 'Repeat the new password',
      mismatch: 'The two passwords are not the same.',
      note: 'Saving signs you out everywhere, including here.',
      submit: 'Save the new password',
      invalid: 'This link has expired or has already been used.',
      missing: 'This link is incomplete. Open it again from your email, or ask for a new one.',
      request_new: 'Ask for a new link',
    },
  },
  legal: {
    version: 'Version {version}, in force from {date}',
  },
  error: {
    reference: 'Reference: {ref}',
    auth: {
      unauthenticated: 'You are not signed in, or your session has ended. Sign in again.',
      forbidden: 'You cannot do that here.',
    },
    common: {
      not_found: 'That could not be found.',
      validation_failed: 'Some details need correcting.',
      state_conflict: 'This changed while you were working. Reload the page and try again.',
      rate_limited: 'Too many attempts. Wait a few minutes, then try again.',
      idempotency_key_reused: 'This request was already sent. Reload the page to see the result.',
      internal: 'Something went wrong on our side. Try again in a moment.',
      service_unavailable: 'This is not available right now. Try again later.',
    },
    validation: {
      email: { invalid: 'Enter a valid email address.' },
      password: {
        too_short: 'Use at least 12 characters.',
        too_long: 'Use at most 200 characters.',
      },
      timezone: { invalid: 'Choose a time zone from the list.' },
      legal: {
        privacy_policy: 'Accept the privacy policy to continue.',
        terms_of_service: 'Accept the terms of service to continue.',
        terms_and_conditions: 'Accept the terms and conditions to continue.',
        lawful_use_policy: 'Accept the lawful use policy to continue.',
        investigator_agreement: 'Accept the investigator agreement to continue.',
        agency_agreement: 'Accept the agency agreement to continue.',
      },
    },
  },
} as const;
