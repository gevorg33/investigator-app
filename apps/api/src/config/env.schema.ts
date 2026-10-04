import { isIP } from 'node:net';
import { domains, type DomainConfigError } from '@investigator/config';
import { z } from 'zod';

/**
 * Validated at boot. A missing or malformed variable must fail the process with a
 * readable message — never start half-configured and fail later under load.
 */
const optionalText = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

/** The raw `TRUSTED_PROXIES` list: comma-separated, blanks dropped. Read at boot and by `configureApp`. */
export function parseTrustedProxies(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

/**
 * One proxy the API may take `X-Forwarded-For` from: an address, a range, or `loopback`. Nothing
 * that trusts a client — `true`, a hop count, every address, every private address — because a
 * trusted client chooses its own address, and every per-IP limit and audit row with it (T-138).
 */
function isProxy(entry: string): boolean {
  if (entry === 'loopback') return true;
  const [address, prefix, ...rest] = entry.split('/');
  const family = isIP(address!);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  const bits = /^\d+$/.test(prefix) ? Number(prefix) : Number.NaN;
  return bits >= 1 && bits <= (family === 4 ? 32 : 128);
}

/** An email address, as loosely as a sender or an override needs checking. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Where Google sends the browser back to (T-062): the API's own callback route. */
export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback';

function isGoogleCallback(env: {
  NODE_ENV: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string | undefined;
}) {
  let url: URL;
  try {
    url = new URL(env.GOOGLE_OAUTH_REDIRECT_URI!);
  } catch {
    return false;
  }
  const secure =
    url.protocol === 'https:' || env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return secure && url.pathname === GOOGLE_CALLBACK_PATH && url.search === '' && url.hash === '';
}

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3001),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    // Present so the redaction test has a realistic secret to assert on.
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // The public names (ADR-0002, T-023): the same variables the Caddyfile reads, turned into
    // origins by the domain map in @investigator/config — which builds every link an email carries.
    // Unset locally, where the map falls back to the dev servers; DOMAIN is required in staging and
    // production, checked below. Each *_HOST overrides its `<name>.<DOMAIN>` default.
    DOMAIN: optionalText,
    APP_HOST: optionalText,
    ADMIN_HOST: optionalText,
    NEWS_HOST: optionalText,

    // Media storage (T-008). Optional locally so the API boots before the account exists
    // (ACTIONS-FOR-ME #4); required in staging and production — checked below. An empty value
    // from .env.example counts as unset.
    CLOUDINARY_CLOUD_NAME: optionalText,
    CLOUDINARY_API_KEY: optionalText,
    CLOUDINARY_API_SECRET: optionalText,
    CLOUDINARY_FOLDER: z.string().min(1).default('investigator/development'),

    // Sending mail (T-036, ACTIONS-FOR-ME #5): Resend, from one sender — `mail.` once the domain is
    // verified (ADR-0002), `onboarding@resend.dev` in Resend's sandbox. Without a key the
    // development transport logs, and refuses to run in production.
    RESEND_API_KEY: optionalText,
    MAIL_FROM_ADDRESS: optionalText.refine((v) => v === undefined || EMAIL.test(v), {
      message: 'MAIL_FROM_ADDRESS must be an email address',
    }),
    // Resend's sandbox delivers only to the account's own address: when set, every email goes there
    // instead of to its recipient. For development and review only — refused in production.
    REVIEW_REQUEST_EMAIL_OVERRIDE: optionalText.refine((v) => v === undefined || EMAIL.test(v), {
      message: 'REVIEW_REQUEST_EMAIL_OVERRIDE must be an email address',
    }),

    // Where this deployment's job queues live in Redis (T-082): environments sharing a Redis keep
    // apart by prefix. Letters, digits, dash and underscore — BullMQ joins keys with colons.
    JOB_QUEUE_PREFIX: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, 'JOB_QUEUE_PREFIX is letters, digits, dash and underscore')
      .default('investigator'),

    // Sign in with Google (T-062). Optional: without them the API offers no Google sign-in, and says
    // so at /auth/providers. All three or none — checked below.
    GOOGLE_OAUTH_CLIENT_ID: optionalText,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalText,
    // Registered with Google exactly, and matched exactly: the one callback, never a pattern.
    GOOGLE_OAUTH_REDIRECT_URI: optionalText,

    // The hops in front of the API whose X-Forwarded-For is believed (T-138): Caddy, and app-web's
    // server for its own calls. Unset trusts nobody, which is right only with nothing in front.
    TRUSTED_PROXIES: z
      .string()
      .optional()
      .transform(parseTrustedProxies)
      .refine((list) => list.every(isProxy), {
        message:
          'TRUSTED_PROXIES lists proxy addresses, CIDR ranges or "loopback" — never true, a hop count, or every address',
      }),
  })
  .superRefine((env, ctx) => {
    const google = [
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'GOOGLE_OAUTH_REDIRECT_URI',
    ] as const;
    if (google.some((name) => env[name]) && !google.every((name) => env[name])) {
      for (const name of google.filter((n) => !env[n])) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when any GOOGLE_OAUTH_ variable is set`,
        });
      }
    }
    if (env.RESEND_API_KEY !== undefined && env.MAIL_FROM_ADDRESS === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_FROM_ADDRESS'],
        message: 'MAIL_FROM_ADDRESS is required when RESEND_API_KEY is set',
      });
    }
    if (env.NODE_ENV === 'production' && env.REVIEW_REQUEST_EMAIL_OVERRIDE !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['REVIEW_REQUEST_EMAIL_OVERRIDE'],
        message:
          "REVIEW_REQUEST_EMAIL_OVERRIDE must not be set in production: it would send everyone's mail to one inbox",
      });
    }
    if (env.GOOGLE_OAUTH_REDIRECT_URI !== undefined && !isGoogleCallback(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_OAUTH_REDIRECT_URI'],
        message: `GOOGLE_OAUTH_REDIRECT_URI must be an absolute URL ending ${GOOGLE_CALLBACK_PATH}, over https outside development`,
      });
    }

    try {
      domains({
        DOMAIN: env.DOMAIN,
        APP_HOST: env.APP_HOST,
        ADMIN_HOST: env.ADMIN_HOST,
        NEWS_HOST: env.NEWS_HOST,
      });
    } catch (error) {
      // The map's only failure; it names the variable, never the value.
      const { variable, message } = error as DomainConfigError;
      ctx.addIssue({ code: 'custom', path: [variable], message });
    }

    if (env.NODE_ENV !== 'staging' && env.NODE_ENV !== 'production') return;

    // Without it every emailed link would point at a developer's localhost.
    if (env.DOMAIN === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['DOMAIN'],
        message: `DOMAIN is required in ${env.NODE_ENV}`,
      });
    }

    for (const name of [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ] as const) {
      if (!env[name]) {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required in ${env.NODE_ENV}`,
        });
      }
    }

    // Caddy is always in front here: trusting nobody would give every request Caddy's address.
    if (env.TRUSTED_PROXIES.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_PROXIES'],
        message: `TRUSTED_PROXIES is required in ${env.NODE_ENV}`,
      });
    }

    // Folders organise, they do not authorize — but a staging configuration copied into
    // production, or the reverse, should fail loudly rather than mix environments' files.
    if (!env.CLOUDINARY_FOLDER.endsWith(`/${env.NODE_ENV}`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CLOUDINARY_FOLDER'],
        message: `CLOUDINARY_FOLDER must end with /${env.NODE_ENV} in ${env.NODE_ENV}`,
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (result.success) return result.data;

  const problems = result.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

  // Names only — never values. A config error must not leak the secret it is about.
  throw new Error(`Invalid environment configuration:\n${problems}`);
}
