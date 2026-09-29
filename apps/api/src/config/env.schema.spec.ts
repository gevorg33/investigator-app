import { describe, expect, it } from 'vitest';
import { parseTrustedProxies, validateEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('env validation', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
  });

  it('fails fast when a required variable is missing', () => {
    const { DATABASE_URL: _omitted, ...missing } = valid;
    expect(() => validateEnv(missing)).toThrow(/DATABASE_URL/);
  });

  it('names every problem, not just the first', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects a too-short SESSION_SECRET', () => {
    expect(() => validateEnv({ ...valid, SESSION_SECRET: 'short' })).toThrow(/32 characters/);
  });

  it('never includes the offending value in the message', () => {
    const secret = 'super-secret-value-that-must-not-leak';
    try {
      validateEnv({ ...valid, PORT: secret });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('labels a problem with no field path as the root rather than a blank name', () => {
    expect(() => validateEnv(null as unknown as Record<string, unknown>)).toThrow(/\(root\)/);
  });

  describe('media storage configuration', () => {
    const cloud = {
      CLOUDINARY_CLOUD_NAME: 'cloud',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
    };

    it('boots locally without Cloudinary credentials', () => {
      expect(() => validateEnv({ ...valid, NODE_ENV: 'development' })).not.toThrow();
    });

    it('treats an empty value, as in .env.example, as unset', () => {
      const env = validateEnv({ ...valid, CLOUDINARY_API_KEY: '' });
      expect(env.CLOUDINARY_API_KEY).toBeUndefined();
    });

    it.each(['staging', 'production'])('requires all three credentials in %s', (NODE_ENV) => {
      expect(() =>
        validateEnv({ ...valid, NODE_ENV, CLOUDINARY_FOLDER: `investigator/${NODE_ENV}` }),
      ).toThrow(/CLOUDINARY_CLOUD_NAME[\s\S]*CLOUDINARY_API_KEY[\s\S]*CLOUDINARY_API_SECRET/);
    });

    it.each(['staging', 'production'])('requires a folder named for %s', (NODE_ENV) => {
      // A configuration copied from another environment fails rather than mixing files.
      expect(() => validateEnv({ ...valid, ...cloud, NODE_ENV })).toThrow(
        new RegExp(`CLOUDINARY_FOLDER must end with /${NODE_ENV}`),
      );
    });

    it('accepts a complete production configuration', () => {
      expect(() =>
        validateEnv({
          ...valid,
          ...cloud,
          NODE_ENV: 'production',
          CLOUDINARY_FOLDER: 'investigator/production',
          TRUSTED_PROXIES: '10.20.0.2,10.20.0.3',
        }),
      ).not.toThrow();
    });

    it('never includes a credential value in the message', () => {
      try {
        validateEnv({ ...valid, ...cloud, NODE_ENV: 'production' });
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).not.toContain('secret');
      }
    });
  });

  describe('the proxies in front of the API (T-138)', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      CLOUDINARY_CLOUD_NAME: 'cloud',
      CLOUDINARY_API_KEY: 'key',
      CLOUDINARY_API_SECRET: 'secret',
      CLOUDINARY_FOLDER: 'investigator/production',
    };

    it('trusts nobody locally unless told, and reads a list of addresses, ranges and loopback', () => {
      expect(validateEnv(valid).TRUSTED_PROXIES).toEqual([]);
      expect(validateEnv({ ...valid, TRUSTED_PROXIES: '' }).TRUSTED_PROXIES).toEqual([]);
      expect(
        validateEnv({
          ...valid,
          TRUSTED_PROXIES: ' 10.20.0.2, 172.18.0.0/16 ,loopback,fd00::1, fd00:1::/64 ',
        }).TRUSTED_PROXIES,
      ).toEqual(['10.20.0.2', '172.18.0.0/16', 'loopback', 'fd00::1', 'fd00:1::/64']);
    });

    it.each([
      ['true', 'every client'],
      ['*', 'every client'],
      ['1', 'a hop count, which believes whoever is one hop out'],
      ['0.0.0.0/0', 'every IPv4 address'],
      ['::/0', 'every IPv6 address'],
      ['uniquelocal', 'every private address'],
      ['10.0.0.0/33', 'a range that is not one'],
      ['10.0.0.1/8/2', 'a malformed range'],
      ['10.0.0.0/x', 'a range with no length'],
      ['fd00::/129', 'an IPv6 range that is not one'],
      ['api.internal', 'a name, which Express cannot match'],
    ])('refuses %s — %s', (value) => {
      expect(() => validateEnv({ ...valid, TRUSTED_PROXIES: value })).toThrow(
        /TRUSTED_PROXIES: .*proxy addresses/,
      );
    });

    it.each(['staging', 'production'])(
      'requires them in %s, where Caddy is always in front',
      (NODE_ENV) => {
        expect(() =>
          validateEnv({ ...production, NODE_ENV, CLOUDINARY_FOLDER: `investigator/${NODE_ENV}` }),
        ).toThrow(new RegExp(`TRUSTED_PROXIES is required in ${NODE_ENV}`));
      },
    );

    it('parses the raw value the same way at boot and when the app is configured', () => {
      expect(parseTrustedProxies(undefined)).toEqual([]);
      expect(parseTrustedProxies('loopback, 10.20.0.2')).toEqual(['loopback', '10.20.0.2']);
    });
  });
});

describe('Google sign-in settings (T-062)', () => {
  const google = {
    GOOGLE_OAUTH_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_OAUTH_CLIENT_SECRET: 'not-a-real-secret',
    GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3001/api/v1/auth/google/callback',
  };

  it('is optional: none of the three is fine, and so are all three', () => {
    expect(validateEnv(valid).GOOGLE_OAUTH_CLIENT_ID).toBeUndefined();
    expect(validateEnv({ ...valid, ...google })).toMatchObject(google);
    // An empty value, as .env.example has, counts as unset.
    expect(
      validateEnv({ ...valid, GOOGLE_OAUTH_CLIENT_ID: '' }).GOOGLE_OAUTH_CLIENT_ID,
    ).toBeUndefined();
  });

  it.each(Object.keys(google))('refuses the others without %s', (missing) => {
    expect(() => validateEnv({ ...valid, ...google, [missing]: '' })).toThrow(
      new RegExp(`${missing} is required when any GOOGLE_OAUTH_ variable is set`),
    );
  });

  it.each([
    ['another path', 'http://localhost:3001/api/v1/auth/callback'],
    ['a query', 'http://localhost:3001/api/v1/auth/google/callback?x=1'],
    ['a fragment', 'http://localhost:3001/api/v1/auth/google/callback#x'],
    ['something that is not a URL', 'not a url'],
  ])('refuses a callback with %s', (_label, uri) => {
    expect(() => validateEnv({ ...valid, ...google, GOOGLE_OAUTH_REDIRECT_URI: uri })).toThrow(
      /GOOGLE_OAUTH_REDIRECT_URI must be an absolute URL ending \/api\/v1\/auth\/google\/callback/,
    );
  });

  it('insists on https outside development and test', () => {
    const cloud = {
      CLOUDINARY_CLOUD_NAME: 'c',
      CLOUDINARY_API_KEY: 'k',
      CLOUDINARY_API_SECRET: 's',
      CLOUDINARY_FOLDER: 'investigator/staging',
      TRUSTED_PROXIES: 'loopback',
      NODE_ENV: 'staging',
    };
    expect(() => validateEnv({ ...valid, ...cloud, ...google })).toThrow(/over https/);
    expect(
      validateEnv({
        ...valid,
        ...cloud,
        ...google,
        GOOGLE_OAUTH_REDIRECT_URI: 'https://app.example.test/api/v1/auth/google/callback',
      }).GOOGLE_OAUTH_REDIRECT_URI,
    ).toBe('https://app.example.test/api/v1/auth/google/callback');
  });
});

describe('job queue prefix (T-082)', () => {
  it('defaults to the platform’s own, and takes another for an environment sharing a Redis', () => {
    expect(validateEnv(valid).JOB_QUEUE_PREFIX).toBe('investigator');
    expect(validateEnv({ ...valid, JOB_QUEUE_PREFIX: 'staging_1' }).JOB_QUEUE_PREFIX).toBe(
      'staging_1',
    );
  });

  it.each(['has:colon', '', 'x'.repeat(65)])('refuses %j', (prefix) => {
    expect(() => validateEnv({ ...valid, JOB_QUEUE_PREFIX: prefix })).toThrow(/JOB_QUEUE_PREFIX/);
  });
});

describe('mail settings (T-036)', () => {
  it('needs a sender with a Resend key, and not the other way round', () => {
    expect(() => validateEnv({ ...valid, RESEND_API_KEY: 're_x' })).toThrow(
      /MAIL_FROM_ADDRESS is required when RESEND_API_KEY is set/,
    );
    expect(
      validateEnv({ ...valid, MAIL_FROM_ADDRESS: 'no-reply@mail.example.test' }).RESEND_API_KEY,
    ).toBeUndefined();
    expect(
      validateEnv({
        ...valid,
        RESEND_API_KEY: 're_x',
        MAIL_FROM_ADDRESS: 'no-reply@mail.example.test',
      }),
    ).toMatchObject({ RESEND_API_KEY: 're_x' });
  });

  it.each(['MAIL_FROM_ADDRESS', 'REVIEW_REQUEST_EMAIL_OVERRIDE'])(
    'refuses a %s that is not an address',
    (name) => {
      expect(() => validateEnv({ ...valid, [name]: 'not an address' })).toThrow(
        new RegExp(`${name} must be an email address`),
      );
    },
  );

  it('refuses the review override in production, where it would send everyone’s mail to one inbox', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      CLOUDINARY_CLOUD_NAME: 'c',
      CLOUDINARY_API_KEY: 'k',
      CLOUDINARY_API_SECRET: 's',
      CLOUDINARY_FOLDER: 'investigator/production',
      TRUSTED_PROXIES: 'loopback',
    };
    expect(() => validateEnv({ ...prod, REVIEW_REQUEST_EMAIL_OVERRIDE: 'o@x.test' })).toThrow(
      /REVIEW_REQUEST_EMAIL_OVERRIDE must not be set in production/,
    );
    expect(
      validateEnv({ ...valid, REVIEW_REQUEST_EMAIL_OVERRIDE: 'o@x.test' })
        .REVIEW_REQUEST_EMAIL_OVERRIDE,
    ).toBe('o@x.test');
  });
});
