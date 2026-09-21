import type { Role } from '../../common/authz/contract';
import type { LegalDocumentType } from './legal.service';

/**
 * Which documents a person must accept, and when (T-022, `legal-consent`).
 *
 * **A compliance decision, written down as data.** Engineering builds the gate; which documents
 * bind whom is counsel's to confirm (ACTIONS-FOR-ME #20), and changing this list is changing a
 * legal position — not a refactor. It lives in one place so that no call site can quietly
 * require a different set.
 *
 * Required means: the current version must be accepted before the step completes. A type with
 * nothing published requires nothing — there is no text to agree to, and a gate that refuses
 * everybody until counsel delivers would be a gate on the wrong thing.
 */
export const REQUIRED_AT_REGISTRATION: readonly LegalDocumentType[] = [
  'PRIVACY_POLICY',
  'TERMS_OF_SERVICE',
];

/**
 * What a role adds on top, accepted when the role is activated rather than at registration: a
 * customer who later becomes an investigator was not an investigator when they signed up, and
 * cannot have agreed to an investigator's obligations then.
 */
const BY_ROLE: Readonly<Record<'CUSTOMER' | 'INVESTIGATOR', readonly LegalDocumentType[]>> = {
  CUSTOMER: ['TERMS_AND_CONDITIONS'],
  // What an investigator is bound by: the agreement itself, and the lawful-use policy that says
  // what this platform will and will not carry (ADR-0009, plan.md §2).
  INVESTIGATOR: ['INVESTIGATOR_AGREEMENT', 'LAWFUL_USE_POLICY'],
};

/** The documents that activating `role` requires, beyond those accepted at registration. */
export function requiredForRole(role: Role): readonly LegalDocumentType[] {
  return role === 'CUSTOMER' || role === 'INVESTIGATOR' ? BY_ROLE[role] : [];
}
