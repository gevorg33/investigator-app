import { join } from 'node:path';

/**
 * Where the stack under test lives (T-139). One module, read by the config, the global setup and
 * the specs, so a port or a path is never written down twice.
 *
 * The app is not on the development port (3000). The API is on 3001, because that is where the
 * built app's `/api` rewrite points: Next resolves a rewrite's destination at build time, so
 * `API_INTERNAL_URL` set when `next start` runs moves server-side reads but not the browser's own
 * calls. The global setup refuses to start while either port is taken — a developer's running
 * API there would otherwise be the one under test.
 */
export const REPO_ROOT = join(import.meta.dirname, '../../../..');
export const APP_WEB = join(REPO_ROOT, 'apps/app-web');
export const API = join(REPO_ROOT, 'apps/api');
export const OUTPUT = join(APP_WEB, 'e2e/.output');

export const WEB_PORT = 3100;
export const API_PORT = 3001;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;

/** The API's log: the development mailer writes each one-time link here (`LogMailer`). */
export const API_LOG = join(OUTPUT, 'api.log');
export const WEB_LOG = join(OUTPUT, 'web.log');

/**
 * The suite's own database, dropped and migrated from empty on every run. Publishing legal
 * documents is global state — once one is published, every registration requires it — so it is
 * never done in a database somebody else is using.
 */
export const E2E_DATABASE = 'investigator_e2e';

// The local defaults are `.env.example`'s; CI sets both (pr.yml), the runtime role's password
// generated per run.
const OWNER_URL =
  process.env['MIGRATION_DATABASE_URL'] ??
  'postgres://postgres:postgres@localhost:5433/investigator_dev';
const RUNTIME_URL =
  process.env['DATABASE_URL'] ??
  'postgres://investigator_app:investigator_app@localhost:5433/investigator_dev';
export const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6380';

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** The owner: DDL, migrations and fixtures only (T-073). */
export const ownerUrl = (database = E2E_DATABASE): string => withDatabase(OWNER_URL, database);

/** What the API connects as — no BYPASSRLS, owns nothing — so row-level security applies. */
export const runtimeUrl = (): string => withDatabase(RUNTIME_URL, E2E_DATABASE);

/**
 * What registration, the customer role and creating an agency require, so each shows a document
 * and records its acceptance. Which types are required is the API's policy
 * (`legal.policy.ts`); these are published so that policy has something to require.
 */
export const PUBLISHED = [
  { type: 'PRIVACY_POLICY', title: 'Privacy policy (test)' },
  { type: 'TERMS_OF_SERVICE', title: 'Terms of service (test)' },
  { type: 'TERMS_AND_CONDITIONS', title: 'Customer terms (test)' },
  // Creating an agency needs its agreement (T-092, T-094).
  { type: 'AGENCY_AGREEMENT', title: 'Agency agreement (test)' },
] as const;
