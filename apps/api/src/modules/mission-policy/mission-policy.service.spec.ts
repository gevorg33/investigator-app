import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { category, customer, type TestDb } from '../../../test/mission-fixtures';
import * as schema from '../../database/schema';
import { missions, missionScreenings } from '../../database/schema';
import { MissionPolicyService, type MissionClassification } from './mission-policy.service';
import type { ScreenableMission } from './mission-policy.service';

const URL =
  process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5433/investigator_dev';

describe('recording a screening', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  const policy = new MissionPolicyService();

  beforeAll(() => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  /** A real mission row, because screening reads its category's band from the database. */
  const mission = async (
    opts: { riskBand?: 'STANDARD' | 'HIGH' | null; description?: string } = {},
  ) => {
    const { userId } = await customer(db);
    const taxonomyNodeId = await category(db, {
      riskBand: opts.riskBand === undefined ? 'STANDARD' : opts.riskBand,
    });
    const [row] = await db
      .insert(missions)
      .values({
        customerId: userId,
        taxonomyNodeId,
        title: 'Counterparty check',
        description: opts.description ?? 'Ownership and filings from public registers.',
        purpose: 'Deciding whether to sign.',
        subjectRelationship: 'BUSINESS_RELATIONSHIP',
      })
      .returning();
    return row!;
  };

  const screenable = (row: Awaited<ReturnType<typeof mission>>): ScreenableMission => ({
    id: row.id,
    taxonomyNodeId: row.taxonomyNodeId,
    title: row.title,
    description: row.description,
    purpose: row.purpose,
    locationLabel: row.locationLabel,
    subjectRelationship: row.subjectRelationship,
    protectiveOrderDeclared: row.protectiveOrderDeclared,
  });

  const stored = async (missionId: string) =>
    db.select().from(missionScreenings).where(eq(missionScreenings.missionId, missionId));

  it('stores the decision, its reasons and the ruleset that produced them', async () => {
    const row = await mission();
    await db.transaction(async (tx) => {
      await policy.screenSubmission(tx, screenable(row), row.version);
    });

    const [screening] = await stored(row.id);
    expect(screening).toMatchObject({
      missionVersion: row.version,
      outcome: 'ROUTINE_REVIEW',
      riskBand: 'STANDARD',
      flags: [],
      aiClassification: null,
    });
    // A result is only explainable against the rules that made it.
    expect(screening?.rulesetVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('reads the band from the mission’s category', async () => {
    const row = await mission({ riskBand: 'HIGH' });
    await db.transaction(async (tx) => {
      await policy.screenSubmission(tx, screenable(row), row.version);
    });
    expect((await stored(row.id))[0]).toMatchObject({
      riskBand: 'HIGH',
      outcome: 'PRIORITY_REVIEW',
    });
  });

  it('treats a mission with no category at all as unbanded', async () => {
    // A draft can be saved without a category. Submission requires one, but screening does not
    // get to assume that — it fails closed on what it is given.
    const row = await mission();
    await db.transaction(async (tx) => {
      await policy.screenSubmission(tx, { ...screenable(row), taxonomyNodeId: null }, row.version);
    });
    expect((await stored(row.id))[0]).toMatchObject({
      riskBand: 'HIGH',
      flags: ['category_unbanded'],
    });
  });

  it('treats a category it cannot resolve as unbanded, not as safe', async () => {
    // Failing closed on a lookup that returns nothing, the same way an unbanded node does.
    const row = await mission();
    await db.transaction(async (tx) => {
      await policy.screenSubmission(
        tx,
        { ...screenable(row), taxonomyNodeId: randomUUID() },
        row.version,
      );
    });
    expect((await stored(row.id))[0]).toMatchObject({
      riskBand: 'HIGH',
      flags: ['category_unbanded'],
    });
  });

  it('treats an unbanded category as HIGH rather than as low', async () => {
    const row = await mission({ riskBand: null });
    await db.transaction(async (tx) => {
      await policy.screenSubmission(tx, screenable(row), row.version);
    });
    expect((await stored(row.id))[0]).toMatchObject({
      riskBand: 'HIGH',
      flags: ['category_unbanded'],
    });
  });

  it('rolls back with the transaction, so a screening never records a submission that failed', async () => {
    const row = await mission();
    await expect(
      db.transaction(async (tx) => {
        await policy.screenSubmission(tx, screenable(row), row.version);
        throw new Error('submission failed after screening');
      }),
    ).rejects.toThrow('submission failed after screening');
    expect(await stored(row.id)).toEqual([]);
  });
});

/**
 * "AI may classify but never decide" (CLAUDE.md non-negotiable 4), tested as behaviour rather
 * than trusted as a convention.
 */
describe('an AI classification is input, not a decision', () => {
  let sql: postgres.Sql;
  let db: TestDb;
  const policy = new MissionPolicyService();

  beforeAll(() => {
    sql = postgres(URL, { max: 4, onnotice: () => {} });
    db = drizzle(sql, { schema });
  });

  afterAll(async () => {
    await sql.end();
  });

  const screenWith = async (classification: MissionClassification | null) => {
    const { userId } = await customer(db);
    const taxonomyNodeId = await category(db, { riskBand: 'STANDARD' });
    const [row] = await db
      .insert(missions)
      .values({
        customerId: userId,
        taxonomyNodeId,
        title: 'Counterparty check',
        description: 'Ownership and filings from public registers.',
        purpose: 'Deciding whether to sign.',
        subjectRelationship: 'BUSINESS_RELATIONSHIP',
      })
      .returning();
    const result = await db.transaction(async (tx) =>
      policy.screenSubmission(
        tx,
        {
          id: row!.id,
          taxonomyNodeId: row!.taxonomyNodeId,
          title: row!.title,
          description: row!.description,
          purpose: row!.purpose,
          locationLabel: row!.locationLabel,
          subjectRelationship: row!.subjectRelationship,
          protectiveOrderDeclared: row!.protectiveOrderDeclared,
        },
        row!.version,
        classification,
      ),
    );
    const [screening] = await db
      .select()
      .from(missionScreenings)
      .where(eq(missionScreenings.missionId, row!.id));
    return { result, screening };
  };

  it('cannot raise the band, add a flag or change the outcome', async () => {
    const alarming: MissionClassification = {
      provider: 'test',
      model: 'test-1',
      labels: ['prohibited', 'stalking', 'unlawful-surveillance'],
      summary: 'This looks like stalking.',
    };
    const reassuring: MissionClassification = {
      provider: 'test',
      model: 'test-1',
      labels: ['benign'],
      summary: 'Routine corporate work.',
    };

    const withAlarming = await screenWith(alarming);
    const withReassuring = await screenWith(reassuring);
    const withNone = await screenWith(null);

    // Same text, same rules, same answer — whatever the model said about it.
    expect(withAlarming.result).toEqual(withReassuring.result);
    expect(withAlarming.result).toEqual(withNone.result);
    expect(withAlarming.screening?.riskBand).toBe('STANDARD');
    expect(withAlarming.screening?.outcome).toBe('ROUTINE_REVIEW');
    expect(withAlarming.screening?.flags).toEqual([]);
  });

  it('keeps the classification beside the decision, so a moderator can see it as input', async () => {
    const classification: MissionClassification = {
      provider: 'test',
      model: 'test-1',
      labels: ['needs-context'],
      summary: 'Relationship to the subject is unclear.',
    };
    const { screening } = await screenWith(classification);
    expect(screening?.aiClassification).toEqual(classification);
  });

  it('stores nothing at all when there is no classifier', async () => {
    // Nothing produces one yet; the AI gateway is Phase 7.
    const { screening } = await screenWith(null);
    expect(screening?.aiClassification).toBeNull();
  });

  it('is not confused by a classification that names a real flag', async () => {
    // A model returning the id of a rule does not thereby set that flag.
    const { screening } = await screenWith({
      provider: 'test',
      model: `test-${randomUUID()}`,
      labels: ['tracking_device', 'device_or_account_access'],
    });
    expect(screening?.flags).toEqual([]);
  });
});
