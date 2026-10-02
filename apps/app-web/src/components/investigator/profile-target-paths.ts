/**
 * Which investigator profile the editing sections write to (T-093): the reader's own — the default,
 * `/account/investigator` — or one their agency holds for a member, which the agency's managers edit
 * at `/agency/investigators/[id]` (T-087). The sections are the same; only where they send changes,
 * and what they may send, differ. Plain data, so a server page can build one and hand it to the
 * client provider (`profile-target.tsx`).
 */
export interface ProfileTarget {
  /** Where the profile's fields are read and patched. */
  profile: string;
  /** Where its service areas are listed, added and removed. */
  areas: string;
  /**
   * The agency writes the storefront only: never the holder's legal name, nor whether customers see
   * it — that waits for the holder's consent (T-183) — and it does not apply for verification.
   */
  agency: boolean;
}

export const OWN_PROFILE: ProfileTarget = {
  profile: '/profiles/investigator/me',
  areas: '/service-areas/me',
  agency: false,
};

/** A profile the agency the reader works in holds for one of its members. */
export function heldProfile(id: string): ProfileTarget {
  const base = `/agencies/current/investigators/${encodeURIComponent(id)}`;
  return { profile: base, areas: `${base}/service-areas`, agency: true };
}
