import type { AuthzContext, AuthzService } from '../../common/authz/authz.service';
import type { Actor } from '../../common/authz/contract';
import type {
  InvestigatorProfileRow,
  OwnInvestigatorProfileRepository,
} from './profiles.repository';

/**
 * The investigator profile an actor works as — quoting on a mission, or browsing the missions they
 * could quote on — or a refusal.
 *
 * Only an investigator the platform would show a customer may do either: published, VERIFIED and
 * accepting work, the conditions discovery applies. One implementation, because browse (T-054)
 * shows exactly the missions a quote would be accepted on; two copies of this check would let the
 * list and the quote disagree.
 *
 * An active account, the INVESTIGATOR role and the workspace's `investigations.create` permission
 * come first. The profile's own state is a 403, not a 404: it is the caller's own profile.
 */
export async function requireQuotingProfile(
  authz: AuthzService,
  profiles: OwnInvestigatorProfileRepository,
  actor: Actor,
  c: AuthzContext,
): Promise<InvestigatorProfileRow> {
  await authz.requireActive(actor, c);
  await authz.requireRole(actor, 'INVESTIGATOR', c);
  await authz.requirePermission(actor, 'investigations.create', c);
  const profile = await authz.visible(actor, await profiles.findMine(actor), c);
  await authz.stateAllows(
    actor,
    profile.visibility === 'PUBLISHED' &&
      profile.verificationStatus === 'VERIFIED' &&
      profile.acceptingWork,
    c,
  );
  return profile;
}
