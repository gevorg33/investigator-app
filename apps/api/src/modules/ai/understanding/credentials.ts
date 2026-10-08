import { AppError } from '../../../common/errors/app-error';

/**
 * The credential screen (T-220, P-9; AI-EXECUTION-PLAN §4 "screens", §6 "Secrets"). It runs on a
 * person's words before they are stored and before any model sees them: a key, a token, a private
 * key or a password written into a message is masked, and the turn is not answered.
 *
 * Deterministic, never a model: a model asked "is this a secret?" would already have been sent it.
 *
 * A password is recognised only where it is introduced — `password`, `пароль`, `գաղտնաբառ` — and
 * then only when it is unmistakably a value: after `:` or `=`, or, after "is" and the like, when it
 * looks like one (six or more characters with a digit, a symbol, or mixed case). So "my password is
 * not working" and "I forgot my password" pass; "password: hunter2" and "мой пароль Qwerty2024" do
 * not. A password of plain lowercase words after "is" passes: the cost of catching it is refusing
 * every sentence that says what a password is like.
 */

/** What kind of secret was found — a code for audit and for the client, never the secret. */
export type CredentialKind = 'api_key' | 'access_token' | 'jwt' | 'private_key' | 'password';

export interface CredentialScreen {
  /** The kinds found, each once, in the order first found. Empty: nothing was found. */
  found: CredentialKind[];
  /** The text with every secret replaced by {@link MASK}. The same text when nothing was found. */
  masked: string;
}

/** What a secret is replaced with. Language-neutral: it stands in the person's own sentence. */
export const MASK = '•••••';

interface Rule {
  kind: CredentialKind;
  pattern: RegExp;
  /** The capture group holding the secret itself; 0 masks the whole match. */
  group: number;
  /** For a password introduced loosely: the value must look like one. */
  looksLikeOne?: boolean;
}

/** A value that is plainly a password: long enough, with a digit, a symbol, or mixed case. */
const passwordLike = (value: string): boolean =>
  value.length >= 6 &&
  (/\d/.test(value) ||
    /[^\p{L}\p{N}]/u.test(value) ||
    (/\p{Lu}/u.test(value) && /\p{Ll}/u.test(value)));

/** Where a password is named, in each language the platform speaks — any inflection that follows. */
const PASSWORD_WORD = String.raw`(?:password|passwd|passcode|pwd|пароль\p{L}*|գաղտնաբառ\p{L}*)`;

const RULES: readonly Rule[] = [
  // A private key: from its header to its footer, or to the end of what was pasted.
  {
    kind: 'private_key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    group: 0,
  },
  // A JSON Web Token: three base64url parts, the first two JSON objects ("eyJ").
  { kind: 'jwt', pattern: /\beyJ[\w-]{8,}\.eyJ[\w-]{8,}\.[\w-]{8,}/g, group: 0 },
  // Provider keys, by the prefixes their issuers give them.
  {
    kind: 'api_key',
    pattern:
      /\b(?:sk-(?:proj-|ant-)?[\w-]{20,}|(?:sk|rk|pk)_(?:live|test)_\w{16,}|whsec_\w{16,}|re_\w{20,}|AIza[\w-]{35}|AKIA[0-9A-Z]{16}|xox[abposr]-[\w-]{10,})/g,
    group: 0,
  },
  {
    kind: 'access_token',
    pattern: /\b(?:gh[pousr]_\w{36,}|github_pat_\w{22,}|glpat-[\w-]{20,})/g,
    group: 0,
  },
  // `password: …`, `пароль=…`, `գաղտնաբառը՝ …`: introduced as a value, whatever it looks like.
  {
    kind: 'password',
    pattern: new RegExp(String.raw`${PASSWORD_WORD}\s*[:=՝]\s*(\S{4,})`, 'giu'),
    group: 1,
  },
  // `my password is …`, `мой пароль — …`, `пароль это …`, `գաղտնաբառս է …`: only a value that looks like one.
  {
    kind: 'password',
    pattern: new RegExp(
      String.raw`${PASSWORD_WORD}\s+(?:is\s+|was\s+|это\s+|—\s*|-\s+|է\s+)?(\S{6,})`,
      'giu',
    ),
    group: 1,
    looksLikeOne: true,
  },
];

/**
 * Finds and masks every secret in `text`. Overlapping finds are masked once; what was found is
 * reported by kind only.
 */
export function screenCredentials(text: string): CredentialScreen {
  const spans: Array<{ start: number; end: number; kind: CredentialKind }> = [];
  for (const rule of RULES) {
    for (const m of text.matchAll(rule.pattern)) {
      // The whole token, punctuation included: "Hunter2!" may end in its own "!", and a sentence's
      // full stop masked costs nothing, where a secret's last character shown would not.
      const value = m[rule.group]!;
      if (rule.looksLikeOne === true && !passwordLike(value)) continue;
      const start = m.index + m[0].lastIndexOf(value);
      spans.push({ start, end: start + value.length, kind: rule.kind });
    }
  }
  if (spans.length === 0) return { found: [], masked: text };

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  let masked = '';
  let at = 0;
  const found: CredentialKind[] = [];
  for (const s of spans) {
    if (!found.includes(s.kind)) found.push(s.kind);
    // Inside or across a span already masked: the one mask covers it.
    if (s.start < at) {
      at = Math.max(at, s.end);
      continue;
    }
    masked += text.slice(at, s.start) + MASK;
    at = s.end;
  }
  return { found, masked: masked + text.slice(at) };
}

/**
 * For a request that stores nothing and answers at once — `/ai/knowledge/answer`,
 * `/ai/discovery/answer`: a field holding a secret is refused, before any model call. The refusal
 * names the field and the kind, never the secret.
 */
export function refuseCredentials(fields: Record<string, string | undefined>): void {
  const issues = Object.entries(fields).flatMap(([field, text]) => {
    const found = text === undefined ? [] : screenCredentials(text).found;
    return found.length === 0
      ? []
      : [{ field, code: 'CREDENTIAL', messageKey: 'error.validation.assistant.credential' }];
  });
  if (issues.length > 0) throw AppError.validation(issues);
}
