import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPatch, DEFAULTS, derived, isSection, SETTINGS_SECTIONS } from './sections';

describe('settings sections (T-084)', () => {
  it('are the sections the database accepts, no more and no fewer', () => {
    const migration = readFileSync(
      join(__dirname, '../../../database/migrations/0024_add_agency_profiles.sql'),
      'utf8',
    );
    const check = migration.slice(migration.indexOf('tenant_settings_known_section'));
    const listed = [...check.slice(0, check.indexOf(')),')).matchAll(/'([a-z]+)'/g)].map(
      (m) => m[1],
    );
    expect(listed).toEqual([...SETTINGS_SECTIONS]);
  });

  it('all have defaults, so nothing must be configured to use the product', () => {
    expect(Object.keys(DEFAULTS)).toEqual([...SETTINGS_SECTIONS]);
    expect(DEFAULTS.branding).toEqual({ accentColor: null, reportHeaderColor: null });
    // Branding is the one section with settings; every other is a place for them, empty for now.
    expect(SETTINGS_SECTIONS.filter((s) => Object.keys(DEFAULTS[s]).length > 0)).toEqual([
      'branding',
    ]);
  });

  it('recognise a section by name, and nothing else', () => {
    expect(isSection('branding')).toBe(true);
    expect(isSection('billing')).toBe(true);
    expect(isSection('theme')).toBe(false);
  });

  it('take colours in any case, and store them lower-case', () => {
    expect(applyPatch('branding', DEFAULTS.branding, { accentColor: '#1D4ED8' })).toEqual({
      values: { accentColor: '#1d4ed8', reportHeaderColor: null },
    });
  });

  it('put a colour back to the platform’s own with null, and leave the rest alone', () => {
    expect(
      applyPatch(
        'branding',
        { accentColor: '#1d4ed8', reportHeaderColor: '#1e3a8a' },
        { accentColor: null },
      ),
    ).toEqual({ values: { accentColor: null, reportHeaderColor: '#1e3a8a' } });
  });

  it('refuse every problem at once, naming the field and why', () => {
    const result = applyPatch('branding', DEFAULTS.branding, {
      accentColor: 'blue',
      reportHeaderColor: '#777777',
      logo: 'x',
    });
    expect(result).toEqual({
      issues: [
        {
          field: 'values.accentColor',
          code: 'INVALID',
          messageKey: 'error.validation.branding.colour',
        },
        {
          field: 'values.reportHeaderColor',
          code: 'LOW_CONTRAST_TEXT',
          messageKey: 'error.validation.branding.low_contrast',
        },
        { field: 'values.logo', code: 'UNKNOWN', messageKey: 'error.validation.settings.unknown' },
      ],
    });
  });

  it('refuse a colour that is not six hex digits, including a shorthand and a non-string', () => {
    for (const bad of ['#fff', '1d4ed8', '#1d4ed8ff', 42]) {
      expect(applyPatch('branding', DEFAULTS.branding, { accentColor: bad })).toMatchObject({
        issues: [{ code: 'INVALID' }],
      });
    }
  });

  it('refuse any setting in a section that has none yet, rather than pretending to save it', () => {
    expect(applyPatch('notifications', {}, { email: true })).toEqual({
      issues: [
        { field: 'values.email', code: 'UNKNOWN', messageKey: 'error.validation.settings.unknown' },
      ],
    });
    expect(applyPatch('billing', {}, {})).toEqual({ values: {} });
  });

  it('derive the text each branding colour carries, and nothing for other sections', () => {
    expect(derived('branding', { accentColor: '#fde68a', reportHeaderColor: null })).toEqual({
      accentText: '#18181b',
      reportHeaderText: null,
    });
    expect(derived('branding', { accentColor: null, reportHeaderColor: '#1e3a8a' })).toEqual({
      accentText: null,
      reportHeaderText: '#ffffff',
    });
    expect(derived('security', {})).toEqual({});
  });
});
