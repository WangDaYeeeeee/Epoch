import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  validateFactorAssessment, validateWeightTier,
  type FactorAssessmentInput, type WeightTierInput,
} from "../domain/allocation-judgment";

export class PostgresAllocationJudgmentRepository {
  constructor(private readonly sql: Sql) {}

  async createCandidate(instrumentId: string): Promise<string> {
    const normalized = instrumentId.trim().toUpperCase();
    if (!normalized.includes(":")) throw new Error("Candidate instrumentId must be canonical");
    const inserted = await this.sql<{ id: string }[]>`
      INSERT INTO investment_candidate (id, instrument_id)
      VALUES (${randomUUID()}, ${normalized})
      ON CONFLICT (instrument_id) DO UPDATE SET status = 'active'
      RETURNING id::text
    `;
    return inserted[0].id;
  }

  async saveAssessment(candidateId: string, input: FactorAssessmentInput, confirmed: boolean): Promise<string> {
    const assessment = validateFactorAssessment(input);
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO factor_assessment (id, candidate_id, as_of, summary, ranking_reason, status)
        VALUES (${id}, ${candidateId}, ${assessment.asOf}, ${assessment.summary}, ${assessment.rankingReason},
                ${confirmed ? "confirmed" : "draft"})
      `;
      for (const item of assessment.items) {
        await transaction`
          INSERT INTO factor_assessment_item (
            assessment_id, factor, conclusion, confidence, evidence, counter_evidence, direction, impact
          ) VALUES (
            ${id}, ${item.factor}, ${item.conclusion}, ${item.confidence}, ${item.evidence},
            ${item.counterEvidence}, ${item.direction}, ${item.impact}
          )
        `;
      }
    });
    return id;
  }

  async saveWeightTier(input: {
    candidateId: string;
    factorAssessmentId: string;
    tier: WeightTierInput;
    confirmed: boolean;
  }): Promise<string> {
    const tier = validateWeightTier(input.tier);
    if (input.confirmed) {
      const rows = await this.sql<{ status: string }[]>`
        SELECT status FROM factor_assessment
        WHERE id = ${input.factorAssessmentId} AND candidate_id = ${input.candidateId}
      `;
      if (rows[0]?.status !== "confirmed") throw new Error("Confirmed weight tier requires a confirmed factor assessment");
    }
    const id = randomUUID();
    await this.sql`
      INSERT INTO weight_tier (
        id, candidate_id, factor_assessment_id, as_of, weight_percent,
        earnings_expectation, primary_risk, invalidation_condition, why_this_tier, status
      ) VALUES (
        ${id}, ${input.candidateId}, ${input.factorAssessmentId}, ${tier.asOf}, ${tier.weightPercent},
        ${tier.earningsExpectation}, ${tier.primaryRisk}, ${tier.invalidationCondition}, ${tier.whyThisTier},
        ${input.confirmed ? "confirmed" : "proposed"}
      )
    `;
    return id;
  }

  async loadCandidate(candidateId: string) {
    const rows = await this.sql<{
      id: string; instrument_id: string; assessment_id: string | null; assessment_status: string | null;
      weight_tier_id: string | null; weight_percent: number | null; weight_tier_status: string | null;
    }[]>`
      SELECT candidate.id::text, candidate.instrument_id,
             assessment.id::text AS assessment_id, assessment.status AS assessment_status,
             tier.id::text AS weight_tier_id, tier.weight_percent, tier.status AS weight_tier_status
      FROM investment_candidate candidate
      LEFT JOIN LATERAL (
        SELECT * FROM factor_assessment
        WHERE candidate_id = candidate.id ORDER BY as_of DESC, recorded_at DESC LIMIT 1
      ) assessment ON true
      LEFT JOIN LATERAL (
        SELECT * FROM weight_tier
        WHERE candidate_id = candidate.id ORDER BY as_of DESC, recorded_at DESC LIMIT 1
      ) tier ON true
      WHERE candidate.id = ${candidateId}
    `;
    return rows[0] ?? null;
  }
}
