// @vitest-environment node
import { catalogs, LOCALES } from '@investigator/i18n';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every message key the API can send has a sentence in every locale (T-135, docs/api/errors.md).
 *
 * The API sends keys, never sentences, and this app turns them into words. A key with no entry
 * falls back to a generic "something went wrong" — the reader is told nothing about the field they
 * can fix. T-092 and T-123 each found one by accident; this finds them all, and every new one.
 *
 * The keys are read from the API's source: every `'error.…'` string outside its specs. The API
 * writes each key out in full for exactly this reason — a key assembled from parts would be
 * invisible here, so a second test refuses one.
 */
const API = fileURLToPath(new URL('../../../../api/src', import.meta.url));
const sources = globSync('**/*.ts', { cwd: API })
  .filter((f) => !f.endsWith('.spec.ts'))
  .map((f) => ({ file: f, text: readFileSync(`${API}/${f}`, 'utf8') }));

const KEY = /['"`](error\.[a-z_]+(?:\.[a-z_]+)+)['"`]/g;
const keys = [
  ...new Set(sources.flatMap((s) => [...s.text.matchAll(KEY)].map((m) => m[1]!))),
].sort();

const messageAt = (catalog: object, key: string): unknown =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      catalog,
    );

describe('the API’s message keys', () => {
  it('are found — the scan is reading the API, not nothing', () => {
    expect(sources.length).toBeGreaterThan(100);
    expect(keys).toEqual(
      expect.arrayContaining([
        'error.common.internal',
        'error.validation.email.invalid',
        'error.validation.legal.agency_agreement',
        'error.validation.policy_review.exceeds_price',
        'error.validation.taxonomy.slug_taken',
      ]),
    );
  });

  it('are each written out whole, so none can hide from this check', () => {
    const assembled = sources.flatMap((s) =>
      [...s.text.matchAll(/`error\.[^`]*\$\{/g)].map(() => s.file),
    );
    expect(assembled).toEqual([]);
  });

  it.each(LOCALES)('each have a sentence in %s', (locale) => {
    const missing = keys.filter((k) => typeof messageAt(catalogs[locale], k) !== 'string');
    expect(missing).toEqual([]);
  });
});
