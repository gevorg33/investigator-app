import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { domains } from '@investigator/config';
import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/config/env.schema';

const ROOT = join(__dirname, '../../..');
const SERVER = join(ROOT, 'infrastructure/compose/server.yml');
const uncommented = (text: string): string => text.replace(/^\s*#.*$/gm, '');
const caddyfile = uncommented(readFileSync(join(ROOT, 'infrastructure/caddy/Caddyfile'), 'utf8'));

interface Service {
  image: string;
  command?: string[];
  ports?: { published?: string }[];
  networks: Record<string, { ipv4_address?: string } | null>;
  environment?: Record<string, string>;
  depends_on?: Record<string, { condition: string }>;
  restart?: string;
  stop_grace_period?: string;
}
interface Stack {
  services: Record<string, Service>;
  networks: Record<
    string,
    {
      internal?: boolean;
      enable_ipv6?: boolean;
      ipam?: { config?: { subnet: string; ip_range?: string }[] };
    }
  >;
}

/** A line in the API's environment file, so a test can see who reads the file. */
const FROM_ENV_FILE = { ENV_FILE_PROBE: 'from-the-file' };

/** What Compose itself makes of server.yml, with the values a deploy supplies. */
function compose(vars: Record<string, string | undefined>) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'edge-')), 'api-vars');
  writeFileSync(envFile, 'ENV_FILE_PROBE=from-the-file\n');
  return spawnSync('docker', ['compose', '-f', SERVER, 'config', '--format', 'json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DOMAIN: 'example.test',
      APP_HOST: undefined,
      ADMIN_HOST: undefined,
      NEWS_HOST: undefined,
      ACME_EMAIL: 'ops@example.test',
      IMAGE_REGISTRY: 'registry.test',
      IMAGE_TAG: 'sha',
      POSTGRES_PASSWORD: 'x',
      API_ENV_FILE: envFile,
      ...vars,
    },
  });
}

function stack(vars: Record<string, string | undefined> = {}): Stack {
  const run = compose(vars);
  expect(run.stderr).not.toMatch(/error/i);
  return JSON.parse(run.stdout) as Stack;
}

/** An IPv4 address as a number, and whether it falls in `a.b.c.d/n`. */
const ip = (a: string) => a.split('.').reduce((n, part) => n * 256 + Number(part), 0);
const within = (address: string, cidr: string) => {
  const [base, bits] = cidr.split('/');
  const size = 2 ** (32 - Number(bits));
  return Math.floor(ip(address) / size) === Math.floor(ip(base!) / size);
};

const PROXIES = ['caddy', 'app-web', 'admin-web'];

/**
 * The server stack's wiring (T-023). The API believes X-Forwarded-For from exactly the proxies in
 * front of it, so who can reach it, and from which address, is part of authentication
 * (docs/operations/client-address.md). These hold what verification found.
 */
describe('the server stack', () => {
  const { services, networks } = stack();
  const on = (network: string) =>
    Object.entries(services)
      .filter(([, s]) => network in s.networks)
      .map(([name]) => name)
      .sort();

  it('publishes ports from Caddy alone', () => {
    const published = Object.entries(services).filter(([, s]) => (s.ports ?? []).length > 0);
    expect(published.map(([name]) => name)).toEqual(['caddy']);
    expect(services['caddy']!.ports!.map((p) => p.published)).toEqual(['80', '443', '443']);
  });

  it('keeps everything but Caddy, the API and the worker on a network with no route out', () => {
    expect(networks['internal']!.internal).toBe(true);
    expect(on('internal')).toEqual([
      'admin-web',
      'api',
      'app-web',
      'caddy',
      'postgres',
      'redis',
      'worker',
    ]);
    expect(on('edge')).toEqual(['caddy']);
    // The way out to the providers, for the API and the worker (which sends the mail) alone. No proxy
    // is on it, so nothing on it holds an address whose X-Forwarded-For the API believes.
    expect(on('egress')).toEqual(['api', 'worker']);
    expect(networks['edge']!.internal).toBeFalsy();
    expect(networks['egress']!.internal).toBeFalsy();
  });

  it('takes IPv6 clients on the edge by NAT, so Caddy sees each one, not Docker’s relay (T-201)', () => {
    // IPv4-only, Docker's userland relay answered IPv6 and every IPv6 client was the gateway.
    expect(networks['edge']!.enable_ipv6).toBe(true);
    const v6 = networks['edge']!.ipam!.config!.map((c) => c.subnet).filter((s) => s.includes(':'));
    // Unique-local: Caddy's own address is never routed; only the published ports are reachable.
    expect(v6).toHaveLength(1);
    expect(v6[0]).toMatch(/^fd[0-9a-f]{2}:[0-9a-f:]*\/64$/);
    // The network the API trusts is untouched: IPv4, fixed addresses, no IPv6 to widen it.
    expect(networks['internal']!.enable_ipv6).toBeFalsy();
  });

  it('trusts X-Forwarded-For from exactly the proxies’ fixed addresses', () => {
    const fixed = PROXIES.map((name) => services[name]!.networks['internal']!.ipv4_address!);
    const trusted = services['api']!.environment!['TRUSTED_PROXIES']!.split(',');
    expect(trusted.sort()).toEqual([...fixed].sort());
    expect(new Set(fixed).size).toBe(PROXIES.length);
  });

  it('never hands a proxy’s address to another container', () => {
    // PostgreSQL once took 10.20.0.2 before Caddy started: Docker allocates from the bottom.
    const { subnet, ip_range } = networks['internal']!.ipam!.config![0]!;
    for (const name of PROXIES) {
      const address = services[name]!.networks['internal']!.ipv4_address!;
      expect(within(address, subnet)).toBe(true);
      expect(within(address, ip_range!)).toBe(false);
    }
    const unfixed = Object.entries(services).filter(
      ([, s]) => 'internal' in s.networks && !s.networks['internal']?.ipv4_address,
    );
    expect(unfixed.map(([name]) => name).sort()).toEqual(['api', 'postgres', 'redis', 'worker']);
  });

  describe('the job worker (T-208)', () => {
    // Since T-204 retention runs only here: a stack without it deletes nothing on schedule, and
    // delivers no event (docs/architecture/jobs.md).
    const worker = services['worker']!;
    const api = services['api']!;

    it('is the API’s image, running the package’s own worker script', () => {
      expect(worker.image).toBe(api.image);
      const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/api/package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      expect(worker.command).toEqual(pkg.scripts['worker']!.split(' '));
      expect(worker.command).toEqual(['node', 'dist/worker.main.js']);
      expect(existsSync(join(ROOT, 'apps/api/src/worker.main.ts'))).toBe(true);
    });

    it('reads the API’s environment file, names and Redis, so its mail and queues are the API’s', () => {
      expect(worker.environment).toMatchObject(FROM_ENV_FILE);
      expect(api.environment).toMatchObject(FROM_ENV_FILE);
      for (const name of ['DOMAIN', 'APP_HOST', 'ADMIN_HOST', 'NEWS_HOST', 'REDIS_URL']) {
        expect(worker.environment![name]).toBe(api.environment![name]);
      }
    });

    it.each(['staging', 'production'])(
      'resolves, with what an environment file holds, to an environment the schema accepts in %s',
      (stage) => {
        // The worker validates the API's whole environment (runWorker → validateEnv), so what this
        // file sets for the API and the schema requires there, the worker needs too. Found when the
        // worker, run from this file, refused to start without TRUSTED_PROXIES.
        const file = {
          NODE_ENV: stage,
          DATABASE_URL: 'postgres://investigator_app:x@postgres:5432/investigator',
          SESSION_SECRET: 'x'.repeat(32),
          CLOUDINARY_CLOUD_NAME: 'cloud',
          CLOUDINARY_API_KEY: 'key',
          CLOUDINARY_API_SECRET: 'secret',
          CLOUDINARY_FOLDER: `investigator/${stage}`,
        };
        for (const service of [api, worker]) {
          expect(() => validateEnv({ ...file, ...service.environment })).not.toThrow();
        }
      },
    );

    it('starts once the database and Redis are healthy, and lets jobs in progress finish on stop', () => {
      expect(worker.depends_on).toMatchObject({
        postgres: { condition: 'service_healthy' },
        redis: { condition: 'service_healthy' },
      });
      expect(worker.restart).toBe('unless-stopped');
      expect(worker.stop_grace_period).toBe('30s');
    });
  });

  it('gives Caddy and the API the same names, as the domain map derives them', () => {
    const names = ['DOMAIN', 'APP_HOST', 'ADMIN_HOST', 'NEWS_HOST'];
    const pick = (env: Record<string, string>) => Object.fromEntries(names.map((n) => [n, env[n]]));
    const edge = pick(services['caddy']!.environment!);
    expect(pick(services['api']!.environment!)).toEqual(edge);
    const map = domains({ DOMAIN: 'example.test' });
    expect(edge).toEqual({
      DOMAIN: new URL(map.marketing).host,
      APP_HOST: new URL(map.app).host,
      ADMIN_HOST: new URL(map.admin).host,
      NEWS_HOST: new URL(map.news).host,
    });
  });

  it('takes a deploy’s own host for a site over the derived one', () => {
    const { services: moved } = stack({ ADMIN_HOST: 'staff.example.test' });
    expect(moved['caddy']!.environment!['ADMIN_HOST']).toBe('staff.example.test');
    expect(moved['api']!.environment!['ADMIN_HOST']).toBe('staff.example.test');
  });

  it.each(['DOMAIN', 'ACME_EMAIL', 'IMAGE_TAG', 'POSTGRES_PASSWORD', 'API_ENV_FILE'])(
    'refuses to resolve without %s',
    (name) => {
      const run = compose({ [name]: '' });
      expect(run.status).not.toBe(0);
      expect(run.stderr).toContain(`required variable ${name} is missing a value`);
    },
  );
});

describe('the Caddyfile', () => {
  const sites = [...caddyfile.matchAll(/^(\S[^\n]*?)\s*\{\s*$/gm)]
    .map((m) => m[1]!)
    .filter((address) => !address.startsWith('('));
  const block = (address: string) =>
    new RegExp(
      `^${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{\\n([\\s\\S]*?)^\\}`,
      'm',
    ).exec(caddyfile)?.[1] ?? '';

  it('writes no hostname: every site address is a variable the domain map also reads', () => {
    expect(sites).toEqual([
      '{$DOMAIN}',
      'www.{$DOMAIN}',
      '{$APP_HOST}',
      '{$ADMIN_HOST}',
      '{$NEWS_HOST}',
    ]);
    expect(caddyfile).not.toMatch(/mydomain|localhost/);
  });

  it('keeps app. and admin. out of search on every response, at the edge', () => {
    for (const site of ['{$APP_HOST}', '{$ADMIN_HOST}']) {
      expect(block(site)).toMatch(/^\theader X-Robots-Tag "noindex, nofollow[^"]*"$/m);
    }
  });

  it('sends the authenticated paths on the marketing site to routes app-web serves', () => {
    const marketing = block('{$DOMAIN}');
    const redirects = [
      ...marketing.matchAll(/^\tredir (\S+) https:\/\/\{\$APP_HOST\}(\S+) permanent$/gm),
    ];
    expect(Object.fromEntries(redirects.map((m) => [m[1], m[2]]))).toEqual({
      '/login': '/sign-in',
      '/sign-in': '/sign-in',
      '/register': '/sign-up',
      '/sign-up': '/sign-up',
      '/dashboard': '/',
    });
    for (const route of ['sign-in', 'sign-up']) {
      expect(existsSync(join(ROOT, `apps/app-web/src/app/(auth)/${route}/page.tsx`))).toBe(true);
    }
  });

  it('issues no cookie on the apex or news., and reaches the API only from app. and admin. (T-025)', () => {
    expect(caddyfile).toMatch(/^\(no_cookies\) \{\n\theader -Set-Cookie\n\}$/m);
    for (const site of ['{$DOMAIN}', '{$NEWS_HOST}']) {
      expect(block(site)).toMatch(/^\timport no_cookies$/m);
      expect(block(site)).not.toContain('api:3001');
    }
    for (const site of ['{$APP_HOST}', '{$ADMIN_HOST}']) {
      expect(block(site)).not.toContain('no_cookies');
      expect(block(site)).toContain('reverse_proxy api:3001');
    }
  });

  it('believes no X-Forwarded-For a client sends: Caddy is the first hop', () => {
    expect(caddyfile).not.toMatch(/trusted_proxies/);
  });

  it('caches only content-hashed assets on app. and admin.', () => {
    for (const site of ['{$APP_HOST}', '{$ADMIN_HOST}']) {
      const text = block(site);
      // Every Cache-Control is matched, and the two matchers exclude each other.
      expect(text).not.toMatch(/^\theader Cache-Control/m);
      expect(text).toContain('@static path /_next/static/* /fonts/*');
      expect(text).toContain('@dynamic not path /_next/static/* /fonts/*');
      expect(text).toContain('header @dynamic Cache-Control "no-store, private"');
    }
  });
});

describe('hostnames in source', () => {
  it('are derived by the domain map, never written into the apps', () => {
    // A public site's dev port or the example apex, outside packages/config. The API's own
    // address (API_INTERNAL_URL, :3001) is internal plumbing, not a public name.
    const files = globSync(
      ['apps/{api,app-web,admin-web}/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
      { cwd: ROOT },
    ).filter((p) => !/\.spec\.tsx?$/.test(p) && !p.startsWith('packages/config/'));
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.filter((p) =>
      /localhost:300[0234]\b|mydomain\.com/.test(readFileSync(join(ROOT, p), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
