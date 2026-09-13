import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { EmailField } from './email';

class Probe {
  email!: string;
}

// Applied as a call rather than `@EmailField()` syntax: tsconfig.json excludes
// **/*.spec.ts, so the transformer does not enable experimentalDecorators here and
// decorator syntax fails to parse. A decorator is a function; calling it is equivalent.
// Goes away with T-064.
EmailField()(Probe.prototype, 'email');

const check = (email: unknown): { ok: boolean; value: unknown } => {
  const dto = plainToInstance(Probe, { email });
  return { ok: validateSync(dto).length === 0, value: dto.email };
};

describe('addresses a person can actually read', () => {
  it('accepts an ordinary address', () => {
    expect(check('someone@example.test').ok).toBe(true);
  });

  // Each of these renders identically to, or deceptively unlike, what it contains.
  // class-validator's IsEmail accepts several of them on its own, which is the point.
  const invisible: Array<[string, string]> = [
    ['zero-width joiner', 'staff\u200D@example.test'],
    ['zero-width non-joiner', 'staff\u200C@example.test'],
    ['zero-width space', 'st\u200Baff@example.test'],
    ['right-to-left override', 'st\u202Eaff@example.test'],
    ['pop directional formatting', 'staff\u202C@example.test'],
    ['soft hyphen', 'sta\u00ADff@example.test'],
    ['word joiner', 'staff\u2060@example.test'],
    ['byte order mark', 'staff\uFEFF@example.test'],
    ['non-breaking space', 'sta\u00A0ff@example.test'],
    ['ideographic space', 'sta\u3000ff@example.test'],
    ['null byte', 'sta\u0000ff@example.test'],
    ['newline', 'staff\n@example.test'],
    ['carriage return', 'staff\r@example.test'],
  ];

  for (const [name, value] of invisible) {
    it(`rejects ${name}`, () => {
      expect(check(value).ok).toBe(false);
    });
  }

  it('is not a ban on non-ASCII -- the product ships in Armenian and Russian', () => {
    // The target is characters with no visible form, not characters from another script.
    expect(check('someone@xn--80ak6aa92e.test').ok).toBe(true);
  });

  it('normalises to NFC, so one address is one account', () => {
    // The same text composed two ways; NFD would otherwise be a second, distinct row.
    const nfd = 'cafe\u0301@example.test';
    const nfc = 'caf\u00E9@example.test';
    expect(nfd).not.toBe(nfc);
    expect(check(nfd).value).toBe(nfc);
  });

  it('trims surrounding whitespace rather than rejecting the address', () => {
    expect(check('  someone@example.test  ')).toEqual({ ok: true, value: 'someone@example.test' });
  });

  it('still enforces the RFC 5321 length limit', () => {
    expect(check(`${'a'.repeat(250)}@example.test`).ok).toBe(false);
  });

  it('leaves a non-string alone for the type check to reject', () => {
    expect(check(12345).ok).toBe(false);
    expect(check(null).ok).toBe(false);
  });
});
