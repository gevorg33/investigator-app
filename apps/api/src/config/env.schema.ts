import { z } from 'zod';

/**
 * Validated at boot. A missing or malformed variable must fail the process with a
 * readable message — never start half-configured and fail later under load.
 */
export const EnvSchema = z.object({
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
