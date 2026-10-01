import { describe, expect, it } from 'vitest';
import { normalisePseudonym, pseudonymIssue } from './pseudonym';

describe('a pseudonym (T-181)', () => {
  it('is one name however it is spaced', () => {
    expect(normalisePseudonym('  North   Star ')).toBe('North Star');
  });

  it('is accepted when it reveals nothing', () => {
    for (const name of [
      'North Star',
      'Ararat Research',
      'Agent K',
      'Կարմիր Աղվես',
      'Тихий Сокол',
    ]) {
      expect(pseudonymIssue(name, 'Anahit Petrosyan')).toBeNull();
    }
    // With no legal name on file there is nothing to compare against.
    expect(pseudonymIssue('North Star', null)).toBeNull();
  });

  it('shares no word with the legal name — first or last, any case, any script', () => {
    expect(pseudonymIssue('Anahit Investigations', 'Anahit Petrosyan')).toBe('own_name');
    expect(pseudonymIssue('The PETROSYAN Bureau', 'Anahit Petrosyan')).toBe('own_name');
    expect(pseudonymIssue('Агентство Петросян', 'Анаит Петросян')).toBe('own_name');
    expect(pseudonymIssue('Պետրոսյան Խումբ', 'Անահիտ Պետրոսյան')).toBe('own_name');
  });

  it('ignores words too short to give anyone away', () => {
    // "Al" and "K" are not a name; "Al K." is not Al Kazarian.
    expect(pseudonymIssue('Al K. Bureau', 'Al Kazarian')).toBeNull();
  });

  it('carries no way to be reached off the platform', () => {
    // Fictional, as fixtures must be (`fixtures.spec.ts`): reserved domains, the 555-01xx range.
    for (const name of [
      'ani@mail.example.test',
      'ani.example.test',
      'Call 555 0100',
      '555-0100-1234',
    ]) {
      expect(pseudonymIssue(name, null)).toBe('contact');
    }
    // A number short of a phone is a name: "Agent 47".
    expect(pseudonymIssue('Agent 47', null)).toBeNull();
  });
});
