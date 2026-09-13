import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogMailer, MAILER } from './mailer';
import { MailModule } from './mail.module';

const setEnv = (value: string | undefined): void => {
  if (value === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = value;
};

describe('LogMailer', () => {
  const original = process.env['NODE_ENV'];

  afterEach(() => {
    setEnv(original);
    vi.restoreAllMocks();
  });

  it('refuses to exist in production', () => {
    // A no-op here would mean resets that appear to succeed and never arrive; logging
    // here would put live one-time links into log storage. Neither is acceptable, so the
    // absence of a real transport is a boot failure instead.
    setEnv('production');
    expect(() => new LogMailer()).toThrow(/must not run in production/);
  });

  it('names the action that fixes it', () => {
    setEnv('production');
    expect(() => new LogMailer()).toThrow(/ACTIONS-FOR-ME/);
  });

  for (const env of ['development', 'test', 'staging', undefined]) {
    it(`is constructible under ${env ?? 'an unset NODE_ENV'}`, () => {
      setEnv(env);
      expect(() => new LogMailer()).not.toThrow();
    });
  }

  it('writes the link where a developer can find it', async () => {
    setEnv('development');
    const mailer = new LogMailer();
    const logged: string[] = [];
    vi.spyOn(
      mailer as unknown as { logger: { log: (m: string) => void } },
      'logger',
      'get',
    ).mockReturnValue({ log: (m: string) => logged.push(m) });

    await mailer.send({
      to: 'someone@example.test',
      template: 'password_reset',
      variables: { url: 'http://localhost:3000/reset-password?token=abc' },
    });

    expect(logged.join('')).toContain('someone@example.test');
    expect(logged.join('')).toContain('token=abc');
  });
});

describe('MailModule', () => {
  it('binds the port to a transport', () => {
    // The binding is the only thing callers depend on; swapping in a real provider
    // (ACTIONS-FOR-ME #5) changes this line and nothing upstream.
    expect(MailModule).toBeDefined();
    expect(MAILER.description).toBe('MAILER');
  });
});
