import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../database/database.module';
import { missionScreenings, taxonomyNodes } from '../../database/schema';
import { screenMission, type ScreeningInput, type ScreeningResult } from './mission-screening';

/**
 * An assessment produced by a model. Stored as labelled input for the moderator and never
 * consulted by the ruleset — see `screenMission`, which has nowhere to receive one.
 *
 * Nothing produces this yet; the AI gateway is Phase 7. When it does, it runs before the
 * submitting transaction opens, never inside it — a model call is not something to hold a row
 * lock through.
 */
export interface MissionClassification {
  provider: string;
  model: string;
  labels: string[];
  summary?: string;
}

/** What screening reads from the mission it is screening. */
export type ScreenableMission = Omit<ScreeningInput, 'categoryBand'> & {
  id: string;
  taxonomyNodeId: string | null;
};

/**
 * Deterministic policy screening, recorded.
 *
 * Screening decides one thing: how urgently a person should look at this mission. It cannot
 * publish and it cannot reject — every mission goes to a moderator regardless of what it
 * finds (docs/product/mission-lifecycle.md). The gate starts closed and stays closed until
 * T-051's per-category configuration opens it deliberately.
 */
@Injectable()
export class MissionPolicyService {
  /**
   * Screens a submission and records the result in the submitting transaction, so a mission
   * can never be under review with no record of why.
   */
  async screenSubmission(
    tx: Tx,
    mission: ScreenableMission,
    missionVersion: number,
    classification: MissionClassification | null = null,
  ): Promise<ScreeningResult> {
    const result = screenMission({
      title: mission.title,
      description: mission.description,
      purpose: mission.purpose,
      locationLabel: mission.locationLabel,
      subjectRelationship: mission.subjectRelationship,
      protectiveOrderDeclared: mission.protectiveOrderDeclared,
      categoryBand: await this.bandOf(tx, mission.taxonomyNodeId),
    });

    await tx.insert(missionScreenings).values({
      missionId: mission.id,
      missionVersion,
      rulesetVersion: result.rulesetVersion,
      outcome: result.outcome,
      riskBand: result.riskBand,
      flags: result.flags,
      aiClassification: classification,
    });

    return result;
  }

  /** Null when the node has no band yet — screening treats that as HIGH rather than as low. */
  private async bandOf(tx: Tx, taxonomyNodeId: string | null) {
    if (taxonomyNodeId === null) return null;
    const [node] = await tx
      .select({ riskBand: taxonomyNodes.riskBand })
      .from(taxonomyNodes)
      .where(eq(taxonomyNodes.id, taxonomyNodeId));
    return node?.riskBand ?? null;
  }
}
