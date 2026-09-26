import { colors } from '@investigator/ui-tokens';
import { describe, expect, it } from 'vitest';
import { brandingProblem, contrast, MIN_TEXT_CONTRAST, MIN_UI_CONTRAST, REFERENCE, textOn } from './branding';

describe('agency branding (T-084)', () => {
  it('measures contrast the way WCAG does', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
    // WCAG's own worked example: #767676 on white is the lightest grey that passes AA.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrast('#ffffff', '#767676')).toBe(contrast('#767676', '#ffffff'));
  });

  it('measures against the design tokens themselves, not a copy that could drift', () => {
    // This app is CommonJS and cannot import the tokens at runtime; this holds its copy equal.
    expect(REFERENCE.surfaces).toEqual([colors.light.surface, colors.light['surface-raised']]);
    expect(REFERENCE.light).toBe(colors.light['primary-contrast']);
    expect(REFERENCE.dark).toBe(colors.light.text);
    expect([MIN_UI_CONTRAST, MIN_TEXT_CONTRAST]).toEqual([3, 4.5]);
  });

  it('writes on a fill in whichever of the two text colours reads better', () => {
    expect(textOn('#1d4ed8')).toBe(REFERENCE.light);
    expect(textOn('#fde68a')).toBe(REFERENCE.dark);
  });

  it.each([
    ['the platform’s own blue', '#1d4ed8', null],
    ['a dark green', '#166534', null],
    ['a pale yellow, lost on a light page', '#fde68a', 'LOW_CONTRAST_SURFACE'],
    ['a mid grey, lost on a light page', '#9ca3af', 'LOW_CONTRAST_SURFACE'],
  ] as const)('as an accent, takes %s: %s → %s', (_, colour, problem) => {
    expect(brandingProblem('accent', colour)).toBe(problem);
  });

  it.each([
    ['a pale yellow, with dark text', '#fde68a', null],
    ['a deep navy, with white text', '#1e3a8a', null],
    // Too light for white text, too dark for the dark text: nothing written on it reads.
    ['a mid grey no text reads on', '#777777', 'LOW_CONTRAST_TEXT'],
  ] as const)('as a report header, takes %s: %s → %s', (_, colour, problem) => {
    expect(brandingProblem('reportHeader', colour)).toBe(problem);
  });

  it('holds an accent to the text rule as well, where the surface rule alone would pass it', () => {
    // #7a7a7a stands out from a light page (4:1 over 3:1), yet neither text colour reaches 4.5:1.
    expect(contrast('#7a7a7a', '#f7f7f8')).toBeGreaterThan(MIN_UI_CONTRAST);
    expect(contrast('#7a7a7a', textOn('#7a7a7a'))).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(brandingProblem('accent', '#7a7a7a')).toBe('LOW_CONTRAST_TEXT');
  });
});
