import type { FieldIssue } from '../../../common/errors/app-error';
import { brandingProblem, HEX, textOn } from './branding';

/**
 * A workspace's settings sections (T-084, tenancy.md §12). The database holds the same list
 * (`tenant_settings_known_section`); `sections.spec.ts` keeps the two equal.
 *
 * **Only branding has settings yet.** The others exist so that the shape is settled — a section is
 * a place, with a default and a version — but each is empty until the task that first *reads* one
 * of its settings adds it. A setting nothing reads is a control that does nothing, and the
 * subtraction test says it does not ship (interaction-design). `billing` is reserved (T-099).
 */
export const SETTINGS_SECTIONS = [
  'general',
  'branding',
  'localisation',
  'notifications',
  'ai',
  'investigations',
  'employees',
  'security',
  'privacy',
  'integrations',
  'billing',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** Null is "the platform's own": an agency that sets nothing looks like the platform. */
export interface BrandingSettings {
  accentColor: string | null;
  reportHeaderColor: string | null;
}

/** A section with no settings yet. */
export type EmptySection = Record<string, never>;

export type SectionValues<S extends SettingsSection> = S extends 'branding'
  ? BrandingSettings
  : EmptySection;

/** Every section's defaults: what a workspace that never saved one has. */
export const DEFAULTS: { readonly [S in SettingsSection]: SectionValues<S> } = {
  general: {},
  branding: { accentColor: null, reportHeaderColor: null },
  localisation: {},
  notifications: {},
  ai: {},
  investigations: {},
  employees: {},
  security: {},
  privacy: {},
  integrations: {},
  billing: {},
};

/** The keys a section accepts, in the order they are reported. */
const KEYS: { readonly [S in SettingsSection]: readonly string[] } = {
  ...(Object.fromEntries(SETTINGS_SECTIONS.map((s) => [s, []])) as unknown as Record<
    SettingsSection,
    readonly string[]
  >),
  branding: ['accentColor', 'reportHeaderColor'],
};

export const isSection = (value: string): value is SettingsSection =>
  (SETTINGS_SECTIONS as readonly string[]).includes(value);

/** What is derived from a section rather than stored: for branding, the text each colour carries. */
export function derived(section: SettingsSection, values: object): Record<string, string | null> {
  if (section !== 'branding') return {};
  const b = values as BrandingSettings;
  return {
    accentText: b.accentColor === null ? null : textOn(b.accentColor),
    reportHeaderText: b.reportHeaderColor === null ? null : textOn(b.reportHeaderColor),
  };
}

const issue = (field: string, code: string, messageKey: string): FieldIssue => ({
  field: `values.${field}`,
  code,
  messageKey,
});

/**
 * A section's new values: `patch` over `current`, checked. A key the section does not have is
 * refused rather than ignored — a client that thinks it saved a setting must be told it did not —
 * and every problem is reported at once.
 */
export function applyPatch(
  section: SettingsSection,
  current: object,
  patch: Readonly<Record<string, unknown>>,
): { values: object } | { issues: FieldIssue[] } {
  const issues: FieldIssue[] = [];
  const next: Record<string, unknown> = { ...current };
  for (const [key, raw] of Object.entries(patch)) {
    if (!KEYS[section].includes(key)) {
      issues.push(issue(key, 'UNKNOWN', 'error.validation.settings.unknown'));
      continue;
    }
    // Branding is the only section with keys, and both of its keys are colours.
    if (raw === null) {
      next[key] = null;
      continue;
    }
    const colour = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (!HEX.test(colour)) {
      issues.push(issue(key, 'INVALID', 'error.validation.branding.colour'));
      continue;
    }
    const problem = brandingProblem(key === 'accentColor' ? 'accent' : 'reportHeader', colour);
    if (problem !== null) {
      issues.push(issue(key, problem, 'error.validation.branding.low_contrast'));
      continue;
    }
    next[key] = colour;
  }
  return issues.length > 0 ? { issues } : { values: next };
}
