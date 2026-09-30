import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInContext, type ExecutionContext } from '../../src/common/context/execution-context';
import { scopedClient } from '../../src/database/scoped-client';
import { testPool } from '../db';
import { agencyContext, personalContext } from '../workspace-context';
import { agency, member } from '../workspace-fixtures';
import { seedMission } from './graph';

/**
 * Blocks under row-level security, as `investigator_app` (T-052).
 *
 * The two promises a block makes are held here, with direct reads and writes, so neither depends
 * on a service remembering it: the blocked person can never read that they were blocked, and yet
 * their own browsing and quoting lose the person who blocked them — through `app_blocked_users()`,
 * which answers for the current user and nobody else.
 */
describe('blocks under row-level security', () => {
  let app: postgres.Sql;
  let scoped: postgres.Sql;
  let owner: postgres.Sql;

  beforeAll(() => {
    app = testPool({ max: 2 });
    scoped = scopedClient(app);
    owner = testPool({ max: 2, role: 'owner' });
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
  });

  const as = <T>(context: ExecutionContext, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    runInContext(context, () => scoped.begin(fn));

  const person = async () => personalContext(owner, (await member(owner)).actor.userId);

  /** `blocker` blocks `blocked`, as the blocker, in the blocker's workspace. */
  const block = (blocker: ExecutionContext, blocked: ExecutionContext) =>
    as(
      blocker,
      (tx) =>
        tx`INSERT INTO user_blocks (blocked_id, source) VALUES (${blocked.userId}, 'profile') RETURNING id`,
    );

  const blockedSet = (who: ExecutionContext) =>
    as(
      who,
      async (tx) => (await tx<{ ids: string[] }[]>`SELECT app_blocked_users() AS ids`)[0]!.ids,
    );

  describe('the block itself', () => {
    it('is its blocker’s, read from any workspace they are in, and nobody else’s', async () => {
      const blocker = await person();
      const blocked = await person();
      const [row] = await block(blocker, blocked);
      const firm = await agency(owner, [{ userId: blocker.userId }]);
      const atWork = await agencyContext(owner, blocker.userId, firm.tenantId);
      const count = (who: ExecutionContext) =>
        as(who, async (tx) => (await tx`SELECT id FROM user_blocks`).map((r) => r['id']));

      expect(await count(blocker)).toEqual([row!['id']]);
      expect(await count(atWork)).toEqual([row!['id']]);
      expect(await count(blocked)).toEqual([]);
      expect(await count(await person())).toEqual([]);
      const [made] = await owner<{ blocker_id: string; tenant_id: string }[]>`
        SELECT blocker_id, tenant_id FROM user_blocks WHERE id = ${row!['id'] as string}`;
      expect(made).toEqual({ blocker_id: blocker.userId, tenant_id: blocker.tenantId });
    });

    it('cannot be made in someone else’s name, or in a workspace one is not in', async () => {
      const [me, them, victim] = [await person(), await person(), await person()];
      await expect(
        as(
          me,
          (tx) => tx`INSERT INTO user_blocks (blocker_id, blocked_id, source)
                          VALUES (${them.userId}, ${victim.userId}, 'profile')`,
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        as(
          me,
          (tx) => tx`INSERT INTO user_blocks (blocked_id, tenant_id, source)
                          VALUES (${victim.userId}, ${them.tenantId}, 'profile')`,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('cannot be of oneself, edited, or removed by the person blocked', async () => {
      const [blocker, blocked] = [await person(), await person()];
      await expect(block(blocker, blocker)).rejects.toThrow(/user_blocks_not_self/);
      const [row] = await block(blocker, blocked);
      await expect(
        as(
          blocker,
          (tx) => tx`UPDATE user_blocks SET label = 'x' WHERE id = ${row!['id'] as string}`,
        ),
      ).rejects.toThrow(/permission denied/);
      const removed = await as(
        blocked,
        (tx) => tx`DELETE FROM user_blocks WHERE id = ${row!['id'] as string}`,
      );
      expect(removed.count).toBe(0);
      const unblocked = await as(
        blocker,
        (tx) => tx`DELETE FROM user_blocks WHERE id = ${row!['id'] as string}`,
      );
      expect(unblocked.count).toBe(1);
    });
  });

  describe('the blocked set', () => {
    it('names the other person to each side, and nobody to anyone else — never who blocked whom', async () => {
      const [blocker, blocked, bystander] = [await person(), await person(), await person()];
      await block(blocker, blocked);
      expect(await blockedSet(blocker)).toEqual([blocked.userId]);
      expect(await blockedSet(blocked)).toEqual([blocker.userId]);
      expect(await blockedSet(bystander)).toEqual([]);
      await expect(
        as(
          { ...bystander, userId: undefined as never },
          async (tx) => (await tx<{ ids: string[] }[]>`SELECT app_blocked_users() AS ids`)[0]!.ids,
        ),
      ).resolves.toEqual([]);
    });

    it('still answers when its owner is not a superuser — as in production — and only by its own policy', async () => {
      // The test databases are owned by a superuser, which row-level security never applies to.
      // Production's owner is not, and with FORCE it is held by the policies like anyone else: the
      // `blocked_set` policy is what lets the function read. Rebuilt here in one transaction,
      // rolled back, with the policy's absence as the negative control.
      const [blocker, blocked] = [await person(), await person()];
      await block(blocker, blocked);
      const role = `blocks_owner_${randomUUID().replaceAll('-', '')}`;
      const answer = async (withPolicy: boolean) => {
        let ids: string[] | undefined;
        await owner
          .begin(async (tx) => {
            await tx.unsafe(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
            await tx.unsafe(`ALTER TABLE user_blocks OWNER TO ${role}`);
            await tx.unsafe(`ALTER FUNCTION app_blocked_users() OWNER TO ${role}`);
            await tx.unsafe(`DROP POLICY blocked_set ON user_blocks`);
            if (withPolicy) {
              await tx.unsafe(
                `CREATE POLICY blocked_set ON user_blocks FOR SELECT TO ${role} USING (true)`,
              );
            }
            await tx`SELECT set_config('app.user_id', ${blocked.userId}, true)`;
            await tx.unsafe('SET LOCAL ROLE investigator_app');
            ids = (await tx<{ ids: string[] }[]>`SELECT app_blocked_users() AS ids`)[0]!.ids;
            throw new Error('rollback');
          })
          .catch((e: unknown) => {
            if ((e as Error).message !== 'rollback') throw e;
          });
        return ids;
      };
      expect(await answer(true)).toEqual([blocker.userId]);
      expect(await answer(false)).toEqual([]);
    });

    it('is not executable by any role but the application’s', async () => {
      const [grant] = await owner<{ public: boolean }[]>`
        SELECT has_function_privilege('public', 'app_blocked_users()', 'EXECUTE') AS public`;
      expect(grant!.public).toBe(false);
    });
  });

  describe('what it takes away', () => {
    const quoteOn = (missionId: string, profileId: string) => (tx: postgres.TransactionSql) => tx`
        INSERT INTO quotes (mission_id, investigator_profile_id, price_minor, currency,
                            estimated_duration_days, scope, deliverables, cancellation_terms, expires_at)
        VALUES (${missionId}, ${profileId}, 1000, 'AMD', 3, 'Scope', 'Report', 'Refund',
                now() + interval '2 days')`;

    const investigator = async () => {
      const who = await person();
      const [profile] = await owner<{ id: string }[]>`
        INSERT INTO investigator_profiles (user_id, visibility) VALUES (${who.userId}, 'PUBLISHED')
        RETURNING id`;
      return { who, profileId: profile!.id };
    };

    const seesMission = (who: ExecutionContext, missionId: string) =>
      as(
        who,
        async (tx) => (await tx`SELECT id FROM missions WHERE id = ${missionId}`).length === 1,
      );

    it.each(['the customer blocks the investigator', 'the investigator blocks the customer'])(
      'hides a published mission and refuses a quote on it when %s',
      async (direction) => {
        const { workspace, missionId } = await seedMission(owner, 'QUOTED');
        const customer = await personalContext(owner, workspace.userId);
        const { who, profileId } = await investigator();
        const other = await investigator();
        if (direction.startsWith('the customer')) await block(customer, who);
        else await block(who, customer);

        expect(await seesMission(who, missionId)).toBe(false);
        await expect(as(who, quoteOn(missionId, profileId))).rejects.toThrow();
        // Everyone else is untouched.
        expect(await seesMission(other.who, missionId)).toBe(true);
        await expect(as(other.who, quoteOn(missionId, other.profileId))).resolves.toBeDefined();
      },
    );

    it('refuses a new quote even where an earlier one still shows the mission', async () => {
      const { workspace, missionId } = await seedMission(owner, 'QUOTED');
      const customer = await personalContext(owner, workspace.userId);
      const { who, profileId } = await investigator();
      await as(who, quoteOn(missionId, profileId));
      await owner`UPDATE quotes SET status = 'WITHDRAWN', withdrawn_at = now()
                   WHERE mission_id = ${missionId}`;
      await block(customer, who);

      // Their own quote keeps the mission theirs to read — what they offered is theirs to see.
      expect(await seesMission(who, missionId)).toBe(true);
      await expect(as(who, quoteOn(missionId, profileId))).rejects.toThrow(/row-level security/);
    });

    it('comes back when the block is removed', async () => {
      const { workspace, missionId } = await seedMission(owner, 'QUOTED');
      const customer = await personalContext(owner, workspace.userId);
      const { who } = await investigator();
      const [row] = await block(customer, who);
      expect(await seesMission(who, missionId)).toBe(false);
      await as(customer, (tx) => tx`DELETE FROM user_blocks WHERE id = ${row!['id'] as string}`);
      expect(await seesMission(who, missionId)).toBe(true);
    });

    it('leaves the parties to a live assignment exactly what they had', async () => {
      const { workspace, missionId } = await seedMission(owner, 'QUOTED');
      const customer = await personalContext(owner, workspace.userId);
      const { who, profileId } = await investigator();
      await as(who, quoteOn(missionId, profileId));
      const [assignment] = await owner<{ id: string }[]>`
        INSERT INTO assignments (mission_id, quote_id, customer_id, investigator_profile_id,
                                 accepted_scope, deliverables, cancellation_terms, price_minor,
                                 currency, estimated_duration_days, payment_reference,
                                 payment_authorized_at, acceptance_due_at, status, accepted_at)
        SELECT ${missionId}, q.id, ${customer.userId}, ${profileId}, 'Scope', 'Report', 'Refund',
               1000, 'AMD', 3, ${`pi_${randomUUID()}`}, now(), now() + interval '2 days',
               'IN_PROGRESS', now()
          FROM quotes q WHERE q.mission_id = ${missionId}
        RETURNING id`;
      await owner`UPDATE missions SET status = 'ASSIGNED' WHERE id = ${missionId}`;
      await block(customer, who);

      const reads = (ctx: ExecutionContext) =>
        as(
          ctx,
          async (tx) => (await tx`SELECT id FROM assignments WHERE id = ${assignment!.id}`).length,
        );
      expect(await reads(customer)).toBe(1);
      expect(await reads(who)).toBe(1);
      expect(await seesMission(who, missionId)).toBe(true);
    });
  });
});
