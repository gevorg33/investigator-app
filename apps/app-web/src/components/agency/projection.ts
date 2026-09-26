import type { OwnAgencyProfile, PublicAgencyProfile } from '@/lib/api/types';

/** The profile's text as the form holds it, saved or not. */
export interface ProfileText {
  displayName: string;
  headline: string;
  about: string;
}

/** Text as the API stores it: trimmed, and blank is no text (agency-profile.service.ts). */
export const clean = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The form's starting text: what is saved, blanks for what is not. */
export const savedText = (own: OwnAgencyProfile): ProfileText => ({
  displayName: own.displayName ?? '',
  headline: own.headline ?? '',
  about: own.about ?? '',
});

/** Whether the form holds text that is not saved — publishing shows only what is. */
export const isDirty = (own: OwnAgencyProfile, text: ProfileText): boolean =>
  clean(text.displayName) !== own.displayName ||
  clean(text.headline) !== own.headline ||
  clean(text.about) !== own.about;

/**
 * What customers would see (T-094): the public projection the API builds for
 * `GET /agencies/:id/profile`, field for field, from the agency's own view and the form's text.
 * The type is the public one, so a field the projection does not have cannot reach the preview.
 *
 * `registeredName` is the name the agency was created with — what customers see while no display
 * name is set. Images are the ones customers would be shown: a file still being checked has no
 * link, and shows as nothing, exactly as it would to them.
 */
export function projection(
  own: OwnAgencyProfile,
  text: ProfileText,
  registeredName: string,
): PublicAgencyProfile {
  return {
    id: own.id,
    name: clean(text.displayName) ?? registeredName,
    // A published profile always has one; a draft's preview shows none until one is written.
    headline: clean(text.headline) ?? '',
    about: clean(text.about),
    countryCode: own.countryCode,
    logo: own.logo?.link ?? null,
    cover: own.cover?.link ?? null,
  };
}
