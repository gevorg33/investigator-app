import type { LegalHoldResource } from '@/lib/api/types';

/**
 * What both the legal-holds page (a server component) and its sheets (client components) need. A
 * plain module, so each side imports the values themselves: taken from a `'use client'` module, a
 * server component would get a reference instead of the array (T-205, client-boundary.spec.ts).
 */

/** The API's bounds on a reason (`REASON_MIN`, `REASON_MAX`, legal-hold.policy.ts). */
export const REASON_MIN = 12;
export const REASON_MAX = 2000;

/** What a hold can name, in the order the console offers them. */
export const RESOURCES: readonly LegalHoldResource[] = [
  'USER',
  'TENANT',
  'MISSION',
  'ASSIGNMENT',
  'MEDIA_ASSET',
];
