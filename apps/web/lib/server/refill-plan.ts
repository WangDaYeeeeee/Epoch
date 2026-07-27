import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  evaluateRefillBatch, validateRefillTransition,
  type RefillBatchNumber, type RefillBatchState, type RefillEvaluationInput,
} from "../domain/refill-plan";

export class PostgresRefillPlanRepository {
  constructor(private readonly sql: Sql) {}

  async create(riskReductionDecisionId: string): Promise<string> {
    const decisions = await this.sql<{ trigger_type: string; outcome: string; execution_id: string | null }[]>`
      SELECT decision.trigger_type, decision.outcome, execution.id::text AS execution_id
      FROM investment_decision decision
      LEFT JOIN execution_record execution ON execution.decision_id = decision.id
      WHERE decision.id = ${riskReductionDecisionId}
    `;
    const decision = decisions[0];
    if (decision?.trigger_type !== "risk" || !["confirmed", "modified"].includes(decision.outcome) || !decision.execution_id) {
      throw new Error("Refill plan requires an executed risk-reduction decision");
    }
    const existing = await this.sql<{ id: string }[]>`
      SELECT id::text FROM refill_plan WHERE risk_reduction_decision_id = ${riskReductionDecisionId}
    `;
    if (existing[0]) return existing[0].id;
    const planId = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO refill_plan (id, risk_reduction_decision_id) VALUES (${planId}, ${riskReductionDecisionId})
      `;
      const triggers = [
        "σₚ returns below 45%",
        "Policy Gate passes for 5 trading days and the original risk signal clears",
        "Restore to the current confirmed target; mandatory after 10 pass days absent invalidation",
      ];
      for (const batchNumber of [1, 2, 3] as const) {
        const batchId = randomUUID();
        await transaction`
          INSERT INTO refill_batch (id, plan_id, batch_number, portion, trigger_description)
          VALUES (${batchId}, ${planId}, ${batchNumber}, ${1 / 3}, ${triggers[batchNumber - 1]})
        `;
        await transaction`
          INSERT INTO refill_batch_transition (id, batch_id, from_state, to_state, reason, evidence)
          VALUES (${randomUUID()}, ${batchId}, 'pending', 'pending', 'PLAN_CREATED', ${transaction.json({})})
        `;
      }
    });
    return planId;
  }

  async evaluate(input: {
    planId: string;
    batchNumber: RefillBatchNumber;
    evaluation: Omit<RefillEvaluationInput, "batchNumber" | "previousBatchesExecuted">;
    targetWeights: { instrumentId: string; weight: number }[];
    calculationRunId: string;
  }) {
    const batches = await this.load(input.planId);
    const batch = batches.find((item) => item.batchNumber === input.batchNumber);
    if (!batch) throw new Error("Refill batch not found");
    const previousBatchesExecuted = batches
      .filter((item) => item.batchNumber < input.batchNumber)
      .every((item) => item.state === "executed");
    const result = evaluateRefillBatch({ ...input.evaluation, batchNumber: input.batchNumber, previousBatchesExecuted });
    if (batch.state !== result.state) {
      validateRefillTransition({ from: batch.state, to: result.state, reason: result.reasons.join(",") || "TRIGGER_PASSED" });
      await this.sql`
        INSERT INTO refill_batch_transition (
          id, batch_id, from_state, to_state, reason, evidence, target_weights, calculation_run_id
        ) VALUES (
          ${randomUUID()}, ${batch.id}, ${batch.state}, ${result.state},
          ${result.reasons.join(",") || "TRIGGER_PASSED"}, ${this.sql.json(input.evaluation)},
          ${this.sql.json(input.targetWeights)}, ${input.calculationRunId}
        )
      `;
    }
    return result;
  }

  async transition(input: { planId: string; batchNumber: RefillBatchNumber; to: "executed" | "not_executed"; reason: string }) {
    const batches = await this.load(input.planId);
    const batch = batches.find((item) => item.batchNumber === input.batchNumber);
    if (!batch) throw new Error("Refill batch not found");
    validateRefillTransition({ from: batch.state, to: input.to, reason: input.reason });
    await this.sql`
      INSERT INTO refill_batch_transition (id, batch_id, from_state, to_state, reason, evidence)
      VALUES (${randomUUID()}, ${batch.id}, ${batch.state}, ${input.to}, ${input.reason.trim()}, ${this.sql.json({})})
    `;
  }

  async load(planId: string): Promise<{
    id: string; batchNumber: RefillBatchNumber; portion: number; triggerDescription: string; state: RefillBatchState;
  }[]> {
    const rows = await this.sql<{
      id: string; batch_number: number; portion: string; trigger_description: string; to_state: RefillBatchState;
    }[]>`
      SELECT batch.id::text, batch.batch_number, batch.portion::text, batch.trigger_description,
             transition.to_state
      FROM refill_batch batch
      JOIN LATERAL (
        SELECT to_state FROM refill_batch_transition
        WHERE batch_id = batch.id ORDER BY recorded_at DESC, id DESC LIMIT 1
      ) transition ON true
      WHERE batch.plan_id = ${planId}
      ORDER BY batch.batch_number
    `;
    return rows.map((row) => ({
      id: row.id,
      batchNumber: row.batch_number as RefillBatchNumber,
      portion: Number(row.portion),
      triggerDescription: row.trigger_description,
      state: row.to_state,
    }));
  }
}
