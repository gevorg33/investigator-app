// The domain map (ADR-0002, T-023). Every public origin the platform serves, read from the same
// variables the Caddyfile reads, so the edge and the code cannot disagree about a hostname. Code
// names a role — `appUrl('/missions')` — never a literal host.

/**
 * The roles a public hostname plays. `mail.` is absent on purpose: it is a sending domain, not an
 * origin anything links to.
 */
export type Site = 'marketing' | 'app' | 'admin' | 'news';

/** Each site's origin — scheme, host and, locally, port. No trailing slash. */
export type DomainMap = Readonly<Record<Site, string>>;

export type DomainEnv = Readonly<Record<string, string | undefined>>;

/**
 * How each site finds its host: its own variable (the Caddyfile's), else its prefix on the apex,
 * else — with no `DOMAIN` — its dev server. app-web and admin-web listen on those ports (`next dev
 * --port`); marketing and news hold theirs for when those apps exist.
 */
const SITE: Readonly<Record<Site, { variable: string; prefix: string; local: string }>> = {
  marketing: { variable: 'DOMAIN', prefix: '', local: 'localhost:3003' },
  app: { variable: 'APP_HOST', prefix: 'app.', local: 'localhost:3000' },
  admin: { variable: 'ADMIN_HOST', prefix: 'admin.', local: 'localhost:3002' },
  news: { variable: 'NEWS_HOST', prefix: 'news.', local: 'localhost:3004' },
};

const SITES = Object.keys(SITE) as Site[];

/** A bare, lowercase hostname with an optional port — no scheme, path, or credentials. */
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/;

/** Plain HTTP only where nothing sits between the browser and the server: this machine. */
const LOOPBACK = new Set(['localhost', '127.0.0.1']);

const read = (env: DomainEnv, name: string): string | undefined => env[name] || undefined;

function hostFor(site: Site, env: DomainEnv): string {
  const apex = read(env, 'DOMAIN');
  return (
    read(env, SITE[site].variable) ?? (apex ? `${SITE[site].prefix}${apex}` : SITE[site].local)
  );
}

/** A domain variable that cannot be used. Names the variable, never its value. */
export class DomainConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(`${variable} ${message}`);
    this.name = 'DomainConfigError';
  }
}

/**
 * Every site's origin, from `DOMAIN` and the `*_HOST` overrides. A host that is not one fails here,
 * at boot, not as a link that goes nowhere.
 *
 * Two sites never share an origin: `admin.` exists so a staff session is unreachable from `app.`,
 * and one origin for both would undo that silently.
 */
export function domains(env: DomainEnv = process.env): DomainMap {
  const map = {} as Record<Site, string>;
  const taken = new Set<string>();
  for (const site of SITES) {
    const host = hostFor(site, env);
    const { variable } = SITE[site];
    if (!HOST.test(host)) {
      throw new DomainConfigError(
        variable,
        'must be a bare lowercase hostname, optionally with a port',
      );
    }
    if (taken.has(host)) {
      throw new DomainConfigError(variable, 'names a host another site already serves from');
    }
    taken.add(host);
    const scheme = LOOPBACK.has(host.split(':')[0]!) ? 'http' : 'https';
    map[site] = `${scheme}://${host}`;
  }
  return map;
}

/** A link into the application: `appUrl('/missions/7')`. The path starts with `/`. */
export function appUrl(path: string, env: DomainEnv = process.env): string {
  return `${domains(env).app}${path}`;
}
