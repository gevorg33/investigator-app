import { afterAll, describe, expect, it } from 'vitest';
import { testPool } from './db';
import { loadDemoData } from './demo-data';

/**
 * `pnpm fixtures:load` builds something real (T-042).
 *
 * The CI step exists to catch a factory that has drifted from a constraint, which it can only
 * do if the loader is the thing that runs. Here it runs against this worker's database and is
 * checked row by row, so the step cannot quietly become a no-op again — and the loader cannot
 * quietly start producing a world with nothing in it.
 */
describe('the demo dataset', () => {
  const owner = testPool({ role: 'owner', max: 1 });

  afterAll(async () => {
    await owner.end();
  });

  it('creates one of each thing, and they refer to each other', async () => {
    const made = await loadDemoData();
    expect(Object.values(made).every((id) => /^[0-9a-f-]{36}$/.test(id))).toBe(true);

    const [row] = await owner<{ customer: string; investigator: string; mission: string }[]>`
      SELECT a.customer_id AS customer, p.user_id AS investigator, a.mission_id AS mission
        FROM assignments a
        JOIN investigator_profiles p ON p.id = a.investigator_profile_id
       WHERE a.id = ${made['assignment']!}`;
    expect(row).toEqual({
      customer: made['customer'],
      investigator: made['investigator'],
      mission: made['mission'],
    });
  });

  it('puts two people in one agency, which a personal workspace cannot show', async () => {
    const made = await loadDemoData();
    const [row] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tenant_memberships WHERE tenant_id = ${made['agency']!}`;
    expect(row?.n).toBe(2);
  });
});
