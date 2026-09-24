import { describe, expect, it } from 'vitest';
import { LOCALE, t } from './messages';

describe('shell messages', () => {
  it('answers each key with its English string', () => {
    expect(LOCALE).toBe('en');
    expect(t('nav.missions')).toBe('Missions');
    expect(t('shell.skip_to_content')).toBe('Skip to content');
  });
});
