import { describe, expect, it } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { MASK, refuseCredentials, screenCredentials } from './credentials';

// Shaped like the real thing, issued by nobody. Built from parts so no scanner mistakes this file
// for a leak — and so a reader can see each is fake.
const OPENAI = `sk-${'proj-'}${'A1b2C3d4'.repeat(4)}`;
const STRIPE = `sk_${'live'}_${'51HxTest'.repeat(3)}`;
const AWS = `AKIA${'IOSFODNN7EXAMPLE'}`;
const GITHUB = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
const JWT = `eyJ${'hbGciOiJIUzI1NiJ9'}.eyJ${'zdWIiOiIxMjM0NTY3ODkwIn0'}.${'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'}`;
const PEM = `-----BEGIN ${'RSA PRIVATE'} KEY-----\nMIIEowIBAAKCAQEA7v\nAbCdEf==\n-----END ${'RSA PRIVATE'} KEY-----`;

describe('the credential screen (T-220)', () => {
  it.each([
    ['an OpenAI key', `My key is ${OPENAI}, can you check it?`, 'api_key', OPENAI],
    ['a Stripe secret key', `use ${STRIPE} for payments`, 'api_key', STRIPE],
    ['an AWS access key', `aws: ${AWS}`, 'api_key', AWS],
    ['a GitHub token', `token ${GITHUB}`, 'access_token', GITHUB],
    ['a JWT', `Bearer ${JWT}`, 'jwt', JWT],
    ['a private key, header to footer', `here:\n${PEM}\nthanks`, 'private_key', PEM],
  ] as const)('masks %s', (_what, text, kind, secret) => {
    const r = screenCredentials(text);
    expect(r.found).toEqual([kind]);
    expect(r.masked).not.toContain(secret);
    expect(r.masked).toContain(MASK);
  });

  it('masks a private key pasted without its footer, to the end', () => {
    const r = screenCredentials(`key: ${PEM.split('\n-----END')[0]}`);
    expect(r).toEqual({ found: ['private_key'], masked: `key: ${MASK}` });
  });

  describe('a password, in three languages', () => {
    it.each([
      // Introduced as a value: whatever it looks like.
      ['password: sunshine', 'password: •••••'],
      ['my password=hunter', 'my password=•••••'],
      ['пароль: солнышко', 'пароль: •••••'],
      ['Пароль=qwerty12', 'Пароль=•••••'],
      ['գաղտնաբառը՝ արեւիկ', 'գաղտնաբառը՝ •••••'],
      ['գաղտնաբառ: abcd', 'գաղտնաբառ: •••••'],
      // Introduced loosely: only a value that looks like one.
      ['my password is Hunter2!', 'my password is •••••'],
      ['the password was Summer2024.', 'the password was •••••'],
      ['мой пароль Qwerty2024', 'мой пароль •••••'],
      ['пароль это zaq1xsw2', 'пароль это •••••'],
      ['пароль — P@ssw0rd', 'пароль — •••••'],
      ['գաղտնաբառս է Arev2024', 'գաղտնաբառս է •••••'],
      // Letters only, but in both cases: still plainly a password.
      ['my password is SunShineSky', 'my password is •••••'],
    ])('masks %j', (text, masked) => {
      expect(screenCredentials(text)).toEqual({ found: ['password'], masked });
    });

    it.each([
      'How do I reset my password?',
      'I forgot my password and cannot log in',
      'my password is not working',
      'my password is incorrect',
      'Как сменить пароль?',
      'мой пароль не подходит',
      'Ինչպե՞ս փոխել գաղտնաբառը',
      'գաղտնաբառս չի աշխատում',
      // Words that merely contain a prefix.
      'ask the sk-team about it',
      'I am an eyJ fan',
    ])('lets %j through', (text) => {
      expect(screenCredentials(text)).toEqual({ found: [], masked: text });
    });
  });

  it('reports each kind once, in the order found, and masks every one', () => {
    const r = screenCredentials(`${JWT} and ${OPENAI} and password: x1y2z3 and ${STRIPE}`);
    expect(r.found).toEqual(['jwt', 'api_key', 'password']);
    expect(r.masked).toBe(`${MASK} and ${MASK} and password: ${MASK} and ${MASK}`);
  });

  it('masks a secret two rules both find only once', () => {
    // A key given as a password: one span inside the other.
    expect(screenCredentials(`password: ${OPENAI}`)).toEqual({
      found: ['api_key', 'password'],
      masked: `password: ${MASK}`,
    });
  });

  it('masks two overlapping finds as one span', () => {
    // The password rule's value runs from the key into the text after it.
    const r = screenCredentials(`password=${GITHUB}!x`);
    expect(r.masked).toBe(`password=${MASK}`);
  });

  describe('for a request that stores nothing', () => {
    it('refuses each field that holds a secret, naming the field and never the secret', () => {
      let thrown: unknown;
      try {
        refuseCredentials({ question: `use ${OPENAI}`, purpose: undefined, other: 'fine' });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(AppError);
      expect(thrown).toMatchObject({
        code: 'VALIDATION_FAILED',
        details: [
          {
            field: 'question',
            code: 'CREDENTIAL',
            messageKey: 'error.validation.assistant.credential',
          },
        ],
      });
      expect(JSON.stringify(thrown)).not.toContain(OPENAI);
    });

    it('lets clean fields through', () => {
      expect(() => refuseCredentials({ question: 'Who works in Yerevan?' })).not.toThrow();
    });
  });
});
