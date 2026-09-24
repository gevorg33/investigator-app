import { describe, expect, it } from 'vitest';
import { LOCALE, t } from './messages';

describe('console messages', () => {
  it('answers each key with its English string', () => {
    expect(LOCALE).toBe('en');
    expect(t('home.title')).toBe('Staff console');
    expect(t('home.sign_in')).toBe('Sign in');
  });
});
