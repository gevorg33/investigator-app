import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';
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
      .map(([name, body]) => ({ name, target: /^pnpm -r ([\w:-]+)$/.exec(body)?.[1] }))
      .filter((s) => s.target !== undefined);
    expect(delegating.length).toBeGreaterThan(2);

    const orphaned = delegating.filter(
      (s) => !packages.some((p) => s.target! in (p.manifest.scripts ?? {})),
    );
    expect(orphaned).toEqual([]);
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

  it('loads fixtures against a database CI migrated from empty', () => {
    // The point of the step: the factories are exercised against the schema as the migrations
    // leave it, so one that has drifted from a constraint fails here rather than at random.
    expect(steps.indexOf('pnpm fixtures:load')).toBeGreaterThan(
      steps.indexOf('pnpm --filter api migration:run'),
    );
  });
});
