/**
 * The five details an agency needs to be usable, as the API names them (T-083, T-150), and each
 * one's label key under `workspace.create_agency`. A plain module, not a client one: the server
 * page reads these as values, which a `'use client'` export would not be.
 */
export const AGENCY_DETAILS = [
  'name',
  'countryCode',
  'businessEmail',
  'timezone',
  'currency',
] as const;
export type AgencyDetail = (typeof AGENCY_DETAILS)[number];

export const DETAIL_LABEL = {
  name: 'name',
  countryCode: 'country',
  businessEmail: 'email',
  timezone: 'timezone',
  currency: 'currency',
} as const satisfies Record<AgencyDetail, string>;
