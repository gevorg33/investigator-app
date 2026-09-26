import { describe, expect, it } from 'vitest';
import { has, LOCALE, t } from './messages';

describe('console messages', () => {
  it('answers each key with its English string, its arguments filled', () => {
    expect(LOCALE).toBe('en');
    expect(t('sign_in.submit')).toBe('Sign in');
    expect(t('shell.signed_in_as', { email: 'r@example.test' })).toBe(
      'Signed in as r@example.test',
    );
    // An argument not given stays visibly unfilled, rather than vanishing.
    expect(t('shell.signed_in_as')).toBe('Signed in as {email}');
  });

  it('says a count in English’s two forms', () => {
    expect(t('verification.item.documents', { count: 1 })).toBe('1 document');
    expect(t('verification.item.documents', { count: 3 })).toBe('3 documents');
  });

  it('knows which of the API’s keys it has a string for', () => {
    expect(has('error.common.not_found')).toBe(true);
    expect(has('error.somewhere.else')).toBe(false);
  });
});
