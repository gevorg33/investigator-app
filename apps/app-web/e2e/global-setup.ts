import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import postgres from 'postgres';
import {
  API,
  API_LOG,
  API_PORT,
  API_URL,
  APP_WEB,
  E2E_DATABASE,
  OUTPUT,
  PUBLISHED,
  REDIS_URL,
  REPO_ROOT,
  WEB_LOG,
  WEB_PORT,
  WEB_URL,
  ownerUrl,
  runtimeUrl,
} from './support/stack';

/**
 * The real stack, from nothing (T-139): a database migrated from empty, the built API against it
 * as the runtime role, and the built app in front of it — the same pieces CI has just built and
 * tested, now driven through a browser.
 *
 * Servers are started here rather than by Playwright's `webServer`, because the database has to
 * exist before the API boots, and the API's output has to be captured to a file: the development
 * mailer writes each emailed link to it, and a spec reads the link from there.
 *
 * Returns the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  requireBuilt();
  await Promise.all([requireFree(API_PORT), requireFree(WEB_PORT)]);
  rmSync(OUTPUT, { recursive: true, force: true });
  mkdirSync(OUTPUT, { recursive: true });

  await createDatabase();
  migrate();
  await publishDocuments();

  const api = start('api', process.execPath, [join(API, 'dist/main.js')], API, API_LOG, {
    // Not `development`: that sends the session cookie without `Secure` and logs through
    // pino-pretty. `test` behaves as a deployed API does — Chromium accepts a `Secure` cookie from
    // http://localhost — and still uses the development mailer, which is how links are read.
    NODE_ENV: 'test',
    PORT: String(API_PORT),
    DATABASE_URL: runtimeUrl(),
    REDIS_URL,
    SESSION_SECRET: randomBytes(32).toString('hex'),
    APP_BASE_URL: WEB_URL,
    LOG_LEVEL: 'info',
  });
  const web = start(
    'web',
    process.execPath,
    [join(APP_WEB, 'node_modules/next/dist/bin/next'), 'start', '--port', String(WEB_PORT)],
    APP_WEB,
    WEB_LOG,
    // NODE_ENV unset, as `pnpm start` runs it; the rewrite stands in for Caddy (next.config.ts).
    { NODE_ENV: undefined, API_INTERNAL_URL: API_URL },
  );

  const stop = async () => {
    await Promise.all([halt(web), halt(api)]);
  };
  try {
    await Promise.all([
      ready(api, `${API_URL}/api/v1/health`, API_LOG),
      ready(web, `${WEB_URL}/sign-in`, WEB_LOG),
    ]);
  } catch (e) {
    await stop();
    throw e;
  }
  return stop;
}

function requireBuilt(): void {
  const missing = [join(API, 'dist/main.js'), join(APP_WEB, '.next/BUILD_ID')].filter(
    (p) => !existsSync(p),
  );
  if (missing.length > 0) {
    throw new Error(
      `The suite runs the built stack. Run \`pnpm build\` first — missing: ${missing.join(', ')}`,
    );
  }
}

/** A port something else holds would put that server under test instead of this one. */
function requireFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(
        new Error(`Port ${port} is in use. Stop whatever holds it — the suite starts its own.`),
      ),
    );
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

async function createDatabase(): Promise<void> {
  const admin = postgres(ownerUrl('postgres'), { max: 1, onnotice: () => {} });
  try {
    // A fixed name, not one taken from input — the one statement here that cannot be
    // parameterised.
    await admin.unsafe(`DROP DATABASE IF EXISTS "${E2E_DATABASE}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${E2E_DATABASE}"`);
  } finally {
    await admin.end();
  }
  // Extensions need a superuser, so they are not a migration (01-extensions.sql says why).
  const owner = postgres(ownerUrl(), { max: 1, onnotice: () => {} });
  try {
    await owner.unsafe(
      readFileSync(
        join(REPO_ROOT, 'infrastructure/docker/postgres/init/01-extensions.sql'),
        'utf8',
      ),
    );
  } finally {
    await owner.end();
  }
}

/** The migrations CI applies to an empty database, by the same command. */
function migrate(): void {
  const run = spawnSync('pnpm', ['--filter', '@investigator/api', 'migration:run'], {
    cwd: REPO_ROOT,
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl() },
    encoding: 'utf8',
  });
  if (run.status !== 0) {
    throw new Error(`Migrations failed against ${E2E_DATABASE}:\n${run.stdout}\n${run.stderr}`);
  }
}

async function publishDocuments(): Promise<void> {
  const owner = postgres(ownerUrl(), { max: 1, onnotice: () => {} });
  try {
    for (const d of PUBLISHED) {
      await owner`
        INSERT INTO legal_documents (type, version, locale, title, content, status,
                                     is_authoritative_locale, published_at, effective_from)
        VALUES (${d.type}::legal_document_type, 1, 'en', ${d.title},
                ${`${d.title}. Written for the browser suite; not a real document.`},
                'CURRENT', true, now(), now())`;
    }
  } finally {
    await owner.end();
  }
}

function start(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  log: string,
  env: Record<string, string | undefined>,
): ChildProcess {
  const out = openSync(log, 'a');
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const child = spawn(command, args, { cwd, env: merged, stdio: ['ignore', out, out] });
  child.on('error', (e) => {
    throw new Error(`${name} failed to start: ${e.message}`);
  });
  return child;
}

async function ready(child: ChildProcess, url: string, log: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${url} exited with ${child.exitCode} before it was ready:\n${tail(log)}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} was not ready within 60s:\n${tail(log)}`);
}

const tail = (log: string): string => readFileSync(log, 'utf8').split('\n').slice(-40).join('\n');

async function halt(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  await exited;
  clearTimeout(timer);
}
