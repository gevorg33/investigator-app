import { opaqueCode } from '../../common/hash/opaque-code';

/**
 * How an investigator refers to a mission's customer before hire (T-100): a short code, the same for
 * everyone who sees that mission, and derived from the **mission** alone. Nothing about the customer
 * goes in, so two missions of the same customer have unrelated aliases and nothing an investigator
 * holds can link them. It names no one; it only lets "the customer of this mission" be said.
 */
export function customerAliasOf(missionId: string): string {
  return opaqueCode('customer-alias', missionId);
}
