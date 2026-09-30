import type postgres from 'postgres';

/**
 * `blockerId` blocks `blockedId` (T-052), written as the owner the way the blocks service would
 * write it: in the blocker's Personal workspace, with the blocked person's investigator profile
 * when they have one. For specs about what a block takes away, not about making one.
 */
export async function blockBetween(
  owner: postgres.Sql,
  blockerId: string,
  blockedId: string,
  opts: { source?: 'profile' | 'mission' | 'assignment' } = {},
): Promise<string> {
  const [row] = await owner<{ id: string }[]>`
    INSERT INTO user_blocks (blocker_id, blocked_id, blocked_profile_id, tenant_id, source)
    SELECT ${blockerId}, ${blockedId},
           (SELECT id FROM investigator_profiles WHERE user_id = ${blockedId}),
           t.id, ${opts.source ?? 'profile'}
      FROM tenants t WHERE t.personal_owner_id = ${blockerId}
    RETURNING id`;
  return row!.id;
}
