import { catalogs, type Catalog } from '@investigator/i18n';
import { createTranslator } from 'use-intl/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createT, englishText, intlConfig } from './translator';

describe('translating', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers in the reader’s language', () => {
    expect(createT('ru')('nav.messages')).toBe('Чаты');
    expect(createT('hy')('account.language.title')).toBe('Լեզու');
    expect(createT('en')('shell.skip_to_content')).toBe('Skip to content');
  });

  it('shows the English text, never the key, when a message fails — and reports it', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = { ...catalogs.ru, nav: { ...catalogs.ru.nav, home: '{unclosed' } } as Catalog;
    const t = createTranslator({ ...intlConfig('ru'), messages: broken });
    expect(t('nav.home')).toBe('Home');
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/^\[i18n\] INVALID_MESSAGE \(ru\): /),
    );
    // The report names the problem, never the values that were passed in.
    const ns = createTranslator({ ...intlConfig('ru'), messages: broken, namespace: 'nav' });
    expect(ns('home')).toBe('Home');
  });

  it('never falls back to a raw key, even when English has nothing there either', () => {
    expect(englishText('nav.home')).toBe('Home');
    expect(englishText('nav')).toBe('');
    expect(englishText('nav.nowhere.deeper')).toBe('');
  });
});
