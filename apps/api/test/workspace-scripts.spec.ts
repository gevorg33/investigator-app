import { execFileSync } from 'node:child_process';
import { chmodSync, globSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const json = (p: string): { name?: string; scripts?: Record<string, string> } =>
  JSON.parse(read(p)) as { name?: string; scripts?: Record<string, string> };

const root = json('package.json');
const workflow = read('.github/workflows/pr.yml');
/** The workflow with its comments taken out — the steps, not the reasoning about them. */
const steps = workflow.replace(/^\s*#.*$/gm, '');
const packages = globSync(['apps/*/package.json', 'packages/*/package.json'], { cwd: ROOT }).map(
  (p) => ({ path: p, manifest: json(p) }),
);

/** Every `pnpm <something>` the workflow runs, with the package it is aimed at. */
const invokedByCi = [...steps.matchAll(/\bpnpm(?: --filter (\S+))?(?: -r)? ([a-z][\w:-]*)/g)]
  .map((m) => ({ filter: m[1], script: m[2]! }))
  .filter((s) => !['install', 'audit', 'run'].includes(s.script));

/**
 * A CI step that runs nothing is worse than a missing one, because it reports success
 * (T-042, T-063).
 *
 * `pr.yml` carried four such steps: `fixtures:load`, `test:integration`, `test:api` and
 * `test:e2e`, each written `--if-present` against a script no package defined. They were green
 * on every run the project has ever done. The coverage gate was the same bug and went unnoticed
 * for four tasks, which is the only reason anyone looked.
 *
 * So `--if-present` is banned outright here, and every script CI names has to resolve to
 * something that exists — with `pnpm -r` failing by itself when no package defines the script.
 */
describe('CI runs what it says it runs', () => {
  it('found the workflow and the scripts', () => {
    expect(invokedByCi.length).toBeGreaterThan(3);
    expect(packages.length).toBeGreaterThan(5);
  });

  it('never uses --if-present, which turns a missing script into a pass', () => {
    expect(steps).not.toMatch(/--if-present/);
    for (const [name, body] of Object.entries(root.scripts ?? {})) {
      expect(`${name}: ${body}`).not.toMatch(/--if-present/);
    }
  });

  it('names only scripts that exist', () => {
    const missing = invokedByCi.filter((s) => {
      const scripts =
        s.filter === undefined
          ? root.scripts
          : packages.find((p) => p.manifest.name?.endsWith(`/${s.filter}`))?.manifest.scripts;
      return !(s.script in (scripts ?? {}));
    });
    expect(missing).toEqual([]);
  });

  it('delegates only to scripts some package defines', () => {
    const delegating = Object.entries(root.scripts ?? {})
      .map(([name, body]) => ({
        name,
        target: /^pnpm -r(?: --[\w-]+=\S+)* ([\w:-]+)$/.exec(body)?.[1],
      }))
      .filter((s) => s.target !== undefined);
    expect(delegating.length).toBeGreaterThan(2);

    const orphaned = delegating.filter(
      (s) => !packages.some((p) => s.target! in (p.manifest.scripts ?? {})),
    );
    expect(orphaned).toEqual([]);
  });

  it('runs the packages’ coverage one at a time, each with the whole machine (T-160)', () => {
    // In parallel, app-web's suite and the API's shared CI's four cores: a test taking 305 ms
    // alone took over 5 s there and timed out, on a change that did not touch it. One package at a
    // time gives each suite every core, and no test's timeout had to move.
    expect(root.scripts?.['test:coverage']).toBe('pnpm -r --workspace-concurrency=1 test:coverage');
    expect(steps).toMatch(/run: pnpm test:coverage\n/);
  });

  it('gates coverage in every package that ships code that runs', () => {
    // A package of pure type declarations compiles to nothing and has nothing to cover. One
    // that exports a value does, and it does not get to escape the gate by having no runner.
    const RUNTIME_EXPORT = /^export\s+(const|let|var|function|async|class|enum|default)\b/m;
    const ungated = packages
      .filter((p) => {
        const dir = p.path.replace(/\/package\.json$/, '');
        return globSync(`${dir}/src/**/*.ts`, { cwd: ROOT })
          .filter((f) => !f.endsWith('.spec.ts'))
          .some((f) => RUNTIME_EXPORT.test(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')));
      })
      .filter((p) => !('test:coverage' in (p.manifest.scripts ?? {})))
      .map((p) => p.path);
    expect(ungated).toEqual([]);
  });

  it('type-checks the tests of every package that has any (T-064)', () => {
    // A package's own tsconfig excludes its specs, so they stay out of dist — which also kept
    // them out of `pnpm typecheck` until T-064. A spec calling a constructor with the wrong
    // number of arguments then surfaced as a TypeError mid-run, or not at all.
    const withSpecs = packages.filter(
      (p) =>
        globSync(`${p.path.replace(/\/package\.json$/, '')}/src/**/*.spec.ts`, { cwd: ROOT })
          .length > 0,
    );
    expect(withSpecs.length).toBeGreaterThan(1);
    const unchecked = withSpecs
      .filter((p) => !('typecheck:specs' in (p.manifest.scripts ?? {})))
      .map((p) => p.path);
    expect(unchecked).toEqual([]);
    expect(root.scripts?.['typecheck']).toContain('pnpm -r typecheck:specs');
  });

  it('loads fixtures against a database CI migrated from empty', () => {
    // The point of the step: the factories are exercised against the schema as the migrations
    // leave it, so one that has drifted from a constraint fails here rather than at random.
    expect(steps.indexOf('pnpm fixtures:load')).toBeGreaterThan(
      steps.indexOf('pnpm --filter api migration:run'),
    );
  });
});

/**
 * T-141: `NODE_ENV=development` in an agent shell made `next build` fail its 404 prerender, while
 * CI and a plain terminal passed. The harness no longer sets it, and the Next apps build as
 * production whatever the caller exported.
 */
describe('builds do not depend on the caller’s NODE_ENV (T-141)', () => {
  const nextApps = packages.filter((p) =>
    /\bnext build\b/.test(p.manifest.scripts?.['build'] ?? ''),
  );

  it('found the Next apps', () => {
    expect(nextApps.map((p) => p.path).sort()).toEqual([
      'apps/admin-web/package.json',
      'apps/app-web/package.json',
    ]);
  });

  it('builds each as production', () => {
    for (const p of nextApps) {
      expect(p.manifest.scripts?.['build']).toBe('NODE_ENV=production next build');
    }
  });

  it('does not set NODE_ENV for every agent shell', () => {
    const settings = JSON.parse(read('.claude/settings.json')) as { env?: Record<string, string> };
    expect(settings.env?.['NODE_ENV']).toBeUndefined();
  });
});

/**
 * T-146: agent shells started on nvm's default Node (20) while `.nvmrc` pins 24, and specs using
 * Node 22+ APIs failed for reasons that were not the code's. The session-start hook puts the
 * pinned version first on PATH through CLAUDE_ENV_FILE, or says loudly that it cannot.
 */
describe('agent shells run the pinned Node (T-146)', () => {
  const pinned = read('.nvmrc').trim();
  const hook = join(ROOT, '.claude/hooks/session-start.sh');

  /** A fake `node` that prints `version`, in its own bin directory. */
  const fakeNode = (dir: string, version: string): string => {
    const bin = join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'node'), `#!/bin/sh\necho v${version}\n`);
    chmodSync(join(bin, 'node'), 0o755);
    return bin;
  };

  const run = (opts: { onPath: string; installed?: string; envFile: boolean }) => {
    const tmp = mkdtempSync(join(tmpdir(), 'session-start-'));
    const onPath = fakeNode(join(tmp, 'default'), opts.onPath);
    const nvm = join(tmp, 'nvm');
    const installed =
      opts.installed === undefined
        ? undefined
        : fakeNode(join(nvm, 'versions/node', `v${opts.installed}`), opts.installed);
    const envFile = join(tmp, 'env');
    writeFileSync(envFile, '');
    const stdout = execFileSync('bash', [hook], {
      encoding: 'utf8',
      env: {
        PATH: `${onPath}:/usr/bin:/bin`,
        HOME: tmp,
        NVM_DIR: nvm,
        CLAUDE_PROJECT_DIR: ROOT,
        ...(opts.envFile ? { CLAUDE_ENV_FILE: envFile } : {}),
      },
    });
    return { stdout, exported: readFileSync(envFile, 'utf8'), installed };
  };

  it('puts the pinned version first on PATH for later commands', () => {
    const r = run({ onPath: '20.20.2', installed: `${pinned}.1.0`, envFile: true });
    expect(r.exported).toBe(`export PATH="${r.installed}:$PATH"\n`);
    expect(r.stdout).toContain(`switched to v${pinned}.1.0 (.nvmrc)`);
  });

  it('warns when the pinned version is not installed', () => {
    const r = run({ onPath: '20.20.2', envFile: true });
    expect(r.exported).toBe('');
    expect(r.stdout).toContain(`but .nvmrc pins ${pinned} — WRONG NODE`);
  });

  it('warns when it has nowhere to write the switch', () => {
    const r = run({ onPath: '20.20.2', installed: `${pinned}.1.0`, envFile: false });
    expect(r.stdout).toContain('WRONG NODE');
  });

  it('says nothing when the shell already runs the pinned version', () => {
    const r = run({ onPath: `${pinned}.1.0`, envFile: true });
    expect(r.exported).toBe('');
    expect(r.stdout).not.toMatch(/^node:/m);
  });
});
