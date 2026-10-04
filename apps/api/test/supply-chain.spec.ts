import { spawnSync } from 'node:child_process';
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const uncommented = (text: string): string => text.replace(/^\s*#.*$/gm, '');

const workflows = globSync('.github/workflows/*.yml', { cwd: ROOT }).map((p) => ({
  path: p,
  text: read(p),
}));
const pr = read('.github/workflows/pr.yml');
const compose = read('infrastructure/compose/local.yml');
const server = read('infrastructure/compose/server.yml');
const dockerfile = read('infrastructure/docker/postgres/Dockerfile');

/** `name:tag@sha256:…` → the digest, or undefined when the reference is a floating tag. */
const digestOf = (ref: string | undefined): string | undefined =>
  /@(sha256:[0-9a-f]{64})/.exec(ref ?? '')?.[1];

/**
 * What CI runs is what was reviewed (T-028).
 *
 * A tag — `actions/checkout@v4`, `redis:8-alpine` — is a promise the publisher can change
 * overnight; a commit SHA or an image digest is not. Everything is pinned, Dependabot proposes
 * the moves, and a person merges each one.
 */
describe('the supply chain', () => {
  it('found the workflows', () => {
    expect(workflows.map((w) => w.path).sort()).toEqual([
      '.github/workflows/pr.yml',
      '.github/workflows/production.yml',
      '.github/workflows/staging.yml',
    ]);
  });

  it('pins every action to a commit SHA, and says which version that is', () => {
    const loose = workflows.flatMap((w) =>
      [...uncommented(w.text).matchAll(/uses:\s*(\S+)(.*)$/gm)]
        .filter(([, ref, rest]) => !/@[0-9a-f]{40}$/.test(ref!) || !/#\s*v\d/.test(rest!))
        .map(([, ref]) => `${w.path}: ${ref}`),
    );
    expect(loose).toEqual([]);
  });

  it('pins every image by digest, in CI, local development, the server stack and the Dockerfile', () => {
    const images = [
      ...[...pr.matchAll(/^\s*image:\s*(\S+)/gm)].map((m) => ['pr.yml', m[1]!]),
      ...[...compose.matchAll(/^\s*image:\s*(\S+)/gm)]
        // An image this file builds itself is named, not pulled; its base is the Dockerfile's.
        .filter((m) => !m[1]!.startsWith('investigator/'))
        .map((m) => ['local.yml', m[1]!]),
      ...[...server.matchAll(/^\s*image:\s*(\S+)/gm)]
        // The platform's own images are tagged per deploy by the pipeline that builds them (T-040).
        .filter((m) => !m[1]!.startsWith('investigator/') && !m[1]!.startsWith('${IMAGE_REGISTRY'))
        .map((m) => ['server.yml', m[1]!]),
      ...[...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((m) => ['Dockerfile', m[1]!]),
    ];
    expect(images.length).toBeGreaterThan(3);
    expect(images.filter(([, ref]) => digestOf(ref) === undefined)).toEqual([]);
  });

  it('runs CI on the same images local development runs', () => {
    // CI once ran Redis 7 while local ran 8: a test result nobody could reproduce on a laptop.
    const ciImage = (service: string) =>
      new RegExp(`^\\s{6}${service}:\\s*\\n(?:\\s{8}#.*\\n)*\\s{8}image:\\s*(\\S+)`, 'm').exec(
        pr,
      )?.[1];
    const composeRedis = /redis:\s*\n(?:\s+#.*\n)*\s+image:\s*(\S+)/.exec(compose)?.[1];
    expect(digestOf(ciImage('redis'))).toBe(digestOf(composeRedis));
    expect(digestOf(ciImage('postgres'))).toBe(digestOf(/^FROM\s+(\S+)/m.exec(dockerfile)?.[1]));
  });

  it('scans the images CI uses, blocking on anything fixable', () => {
    const scan = /- name: Image scan[\s\S]*?done/.exec(uncommented(pr))?.[0] ?? '';
    expect(scan).toContain(
      'docker build -q -t investigator/postgres:ci infrastructure/docker/postgres',
    );
    expect(digestOf(/(redis:\S+)/.exec(scan)?.[1])).toBe(
      digestOf(/redis:\s*\n(?:\s+#.*\n)*\s+image:\s*(\S+)/.exec(compose)?.[1]),
    );
    expect(scan).toMatch(/--exit-code 1 --severity CRITICAL,HIGH --ignore-unfixed/);
    expect(digestOf(/(aquasec\/trivy\S+)/.exec(scan)?.[1])).toBeDefined();
  });

  it('accepts a scan finding only by CVE, on one path, until it expires, as the register records', () => {
    const ignore = read('.trivyignore.yaml');
    const entries = [
      ...ignore.matchAll(/- id: (\S+)[\s\S]*?paths:\s*\n\s*- (\S+)\s*\n\s*expired_at: (\S+)/g),
    ];
    expect(entries.length).toBe((ignore.match(/- id:/g) ?? []).length);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, id, path, expires] of entries) {
      expect(id, 'a CVE, never a wildcard').toMatch(/^(CVE|GHSA)-/);
      expect(path, id).toBe('usr/local/bin/gosu');
      expect(expires, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const register = read('docs/operations/image-scan-exceptions.md');
    for (const expires of new Set(entries.map((e) => e[3]))) expect(register).toContain(expires!);
    expect(register).toContain('usr/local/bin/gosu');
  });

  it('proposes updates for every ecosystem, and never merges one by itself', () => {
    const dependabot = read('.github/dependabot.yml');
    for (const ecosystem of ['npm', 'github-actions', 'docker', 'docker-compose']) {
      expect(dependabot).toMatch(new RegExp(`package-ecosystem: ${ecosystem}\\n`));
    }
    expect([...dependabot.matchAll(/default-days: (\d+)/g)].every((m) => Number(m[1]) >= 7)).toBe(
      true,
    );
    // No workflow merges on anyone's behalf: an auto-merged bump is a supply-chain path.
    const merging = workflows.filter((w) =>
      /auto-?merge|gh pr merge|enable-pull-request-automerge/i.test(uncommented(w.text)),
    );
    expect(merging.map((w) => w.path)).toEqual([]);
  });

  it('builds no source map into a bundle served to the public', () => {
    for (const app of ['app-web', 'admin-web', 'marketing-web']) {
      const options = (
        JSON.parse(read(`apps/${app}/tsconfig.json`)) as {
          compilerOptions: Record<string, unknown>;
        }
      ).compilerOptions;
      expect([options['sourceMap'], options['declarationMap']], app).toEqual([false, false]);
    }
    expect(uncommented(pr)).toMatch(/run: \.\/scripts\/check-no-public-sourcemaps\.sh/);
  });
});

describe('the public source-map check', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const tree = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'maps-'));
    dirs.push(dir);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return dir;
  };
  const check = (dir: string) => {
    const run = spawnSync(join(ROOT, 'scripts/check-no-public-sourcemaps.sh'), [dir], {
      encoding: 'utf8',
    });
    return { code: run.status, output: run.stdout + run.stderr };
  };

  it('passes a public bundle with no maps', () => {
    expect(check(tree({ 'apps/app-web/dist/index.js': 'export {};\n' })).code).toBe(0);
  });

  it('fails a map file in a public app', () => {
    const run = check(tree({ 'apps/marketing-web/dist/index.js.map': '{}' }));
    expect(run.code).toBe(1);
    expect(run.output).toContain('index.js.map');
  });

  it('fails a script that points at a map, inline or not — including a Next build', () => {
    const run = check(
      tree({
        'apps/app-web/.next/static/chunks/main.js': 'x();\n//# sourceMappingURL=main.js.map\n',
      }),
    );
    expect(run.code).toBe(1);
    expect(run.output).toContain('main.js');
  });

  it('leaves the API its maps — a server, not a public bundle', () => {
    expect(check(tree({ 'apps/api/dist/main.js.map': '{}' })).code).toBe(0);
  });

  it('holds for this repository as it is built', () => {
    // CI runs the script after the build; locally there may be no build output, which passes.
    expect(check(ROOT).code).toBe(0);
  });
});

/**
 * Only Caddy can say the Caddyfile loads (T-202). The script runs it in Docker, so these put a
 * stand-in `docker` first on the PATH and read what it was asked to run.
 */
describe('the Caddyfile check', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const check = (exitCode: number, caddyDir?: string) => {
    const bin = mkdtempSync(join(tmpdir(), 'caddy-check-'));
    dirs.push(bin);
    const calls = join(bin, 'calls');
    writeFileSync(
      join(bin, 'docker'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${calls}"\nexit ${exitCode}\n`,
      { mode: 0o755 },
    );
    const run = spawnSync(
      join(ROOT, 'scripts/check-caddyfile.sh'),
      caddyDir === undefined ? [] : [caddyDir],
      { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env['PATH']}` } },
    );
    return { code: run.status, args: readFileSync(calls, 'utf8').split('\n') };
  };

  it('runs in CI', () => {
    expect(uncommented(pr)).toMatch(/run: \.\/scripts\/check-caddyfile\.sh$/m);
  });

  it('validates and format-checks with the Caddy image the server stack runs', () => {
    const { code, args } = check(0);
    expect(code).toBe(0);
    const pinned = /^\s*image:\s*(caddy:\S+)/m.exec(server)?.[1];
    expect(digestOf(pinned)).toBeDefined();
    expect(args).toContain(pinned);
    expect(args).toContain(`${join(ROOT, 'infrastructure/caddy')}:/etc/caddy:ro`);
    expect(args.at(-2)).toBe(
      'caddy validate --config /etc/caddy/Caddyfile && caddy fmt --diff /etc/caddy/Caddyfile',
    );
    // Every name the file reads is given, and none is a domain anyone could own.
    for (const name of ['DOMAIN', 'APP_HOST', 'ADMIN_HOST', 'NEWS_HOST', 'ACME_EMAIL']) {
      expect(args.find((a) => a.startsWith(`${name}=`))).toMatch(/example\.test$/);
    }
  });

  it('checks the directory it is given', () => {
    const dir = mkdtempSync(join(tmpdir(), 'caddyfile-'));
    dirs.push(dir);
    expect(check(0, dir).args).toContain(`${realpathSync(dir)}:/etc/caddy:ro`);
  });

  it('fails when Caddy does', () => {
    expect(check(1).code).toBe(1);
  });
});
