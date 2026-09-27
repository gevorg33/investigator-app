import { isIP } from 'node:net';
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

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(3001),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

    // Present so the redaction test has a realistic secret to assert on.
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    // Origin of the web application, used to build verification and password-reset links.
    // Validated as a URL so a malformed value fails at boot rather than producing links
    // that silently go nowhere. Host-only session cookies mean this is app., not the apex
    // (ADR-0002).
    APP_BASE_URL: z.url().default('http://localhost:3000'),

    // Media storage (T-008). Optional locally so the API boots before the account exists
    // (ACTIONS-FOR-ME #4); required in staging and production — checked below. An empty value
    // from .env.example counts as unset.
    CLOUDINARY_CLOUD_NAME: optionalText,
    CLOUDINARY_API_KEY: optionalText,
    CLOUDINARY_API_SECRET: optionalText,
    CLOUDINARY_FOLDER: z.string().min(1).default('investigator/development'),

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
    if (env.NODE_ENV !== 'staging' && env.NODE_ENV !== 'production') return;

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
