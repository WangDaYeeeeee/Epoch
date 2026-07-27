import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  validateDecision, validateExecution, type DecisionInput, type DecisionJournalEntry, type ExecutionInput,
} from "../domain/decision-journal";

type RunRow = {
  calculation_type: string;
  status: string;
  output: { policyGate?: { passed?: boolean } } | null;
};

export class PostgresDecisionJournalRepository {
  constructor(private readonly sql: Sql) {}

  async decide(input: DecisionInput): Promise<string> {
    const decision = validateDecision(input);
    const rows = await this.sql<RunRow[]>`
      SELECT calculation_type, status, output
      FROM calculation_run WHERE id = ${decision.calculationRunId}
    `;
    const run = rows[0];
    if (!run || run.calculation_type !== "portfolio-risk-rebalance" || !["succeeded", "degraded"].includes(run.status)) {
      throw new Error("Decision requires a completed portfolio-risk-rebalance CalculationRun");
    }
    if (decision.outcome !== "rejected" && run.output?.policyGate?.passed !== true) {
      throw new Error("A failed Policy Gate can only be rejected");
    }
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO investment_decision (
          id, calculation_run_id, trigger_type, outcome, rationale, monitoring_notes,
          decided_at, strategy_version_id
        ) VALUES (
          ${id}, ${decision.calculationRunId}, ${decision.triggerType}, ${decision.outcome},
          ${decision.rationale}, ${decision.monitoringNotes}, ${decision.decidedAt},
          'epoch-satellite-v0.1.0'
        )
      `;
      await transaction`
        INSERT INTO rebalance_record (
          decision_id, trigger_type, volatility_snapshot, portfolio_risk_snapshot,
          weight_tier_snapshot, target_weight_snapshot, monitoring_exceptions,
          action_plan, watchlist, strategy_version_id, parameter_set_id,
          calculation_run_id
        )
        SELECT
          ${id}, ${decision.triggerType},
          jsonb_build_object(
            'instruments', COALESCE(run.output->'instruments', '[]'::jsonb),
            'anchor', COALESCE(anchor.snapshot, 'null'::jsonb),
            'estimator', jsonb_build_object(
              'modelVersion', run.model_version,
              'diagnostics', COALESCE(run.diagnostics, '{}'::jsonb)
            )
          ),
          jsonb_build_object(
            'portfolio', COALESCE(run.output->'portfolio', '{}'::jsonb),
            'policyGate', COALESCE(run.output->'policyGate', '{}'::jsonb)
          ),
          COALESCE(tiers.snapshot, '[]'::jsonb),
          COALESCE(run.input_payload->'targetWeights', '[]'::jsonb),
          COALESCE(run.warnings::text, '[]'),
          ${decision.rationale},
          ${decision.monitoringNotes},
          COALESCE(run.strategy_version_id, 'epoch-satellite-v0.1.0'),
          COALESCE(run.parameter_set_id, 'default-draft-v0.1.0'),
          run.id
        FROM calculation_run run
        LEFT JOIN LATERAL (
          SELECT to_jsonb(risk_anchor) AS snapshot
          FROM risk_drift_anchor risk_anchor
          WHERE risk_anchor.calculation_run_id = run.id
          LIMIT 1
        ) anchor ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object(
            'instrumentId', candidate.instrument_id,
            'weightPercent', tier.weight_percent,
            'earningsExpectation', tier.earnings_expectation,
            'primaryRisk', tier.primary_risk,
            'whyThisTier', tier.why_this_tier,
            'invalidationCondition', tier.invalidation_condition,
            'asOf', tier.as_of
          ) ORDER BY candidate.instrument_id) AS snapshot
          FROM investment_candidate candidate
          JOIN LATERAL (
            SELECT * FROM weight_tier
            WHERE candidate_id = candidate.id AND status = 'confirmed'
            ORDER BY as_of DESC, recorded_at DESC LIMIT 1
          ) tier ON true
          WHERE candidate.instrument_id IN (
            SELECT value->>'instrumentId'
            FROM jsonb_array_elements(COALESCE(run.input_payload->'targetWeights', '[]'::jsonb))
          )
        ) tiers ON true
        WHERE run.id = ${decision.calculationRunId}
      `;
    });
    return id;
  }

  async recordExecution(input: ExecutionInput): Promise<string> {
    const execution = validateExecution(input);
    const decisions = await this.sql<{ outcome: string }[]>`
      SELECT outcome FROM investment_decision WHERE id = ${execution.decisionId}
    `;
    if (!["confirmed", "modified"].includes(decisions[0]?.outcome ?? "")) {
      throw new Error("Execution requires a confirmed or modified decision");
    }
    const id = randomUUID();
    await this.sql`
      INSERT INTO execution_record (
        id, decision_id, executed_at, broker_reference, actual_weights, note
      ) VALUES (
        ${id}, ${execution.decisionId}, ${execution.executedAt}, ${execution.brokerReference},
        ${this.sql.json(execution.actualWeights)}, ${execution.note}
      )
    `;
    return id;
  }

  async load(limit = 50): Promise<DecisionJournalEntry[]> {
    const rows = await this.sql<{
      id: string; calculation_run_id: string; trigger_type: string; outcome: string;
      rationale: string; monitoring_notes: string; decided_at: string; input_payload: Record<string, unknown> | null;
      risk_output: Record<string, unknown> | null; rebalance_record: Record<string, unknown> | null;
      execution_id: string | null; executed_at: string | null;
      broker_reference: string | null; actual_weights: unknown;
    }[]>`
      SELECT decision.id::text, decision.calculation_run_id::text, decision.trigger_type, decision.outcome,
             decision.rationale, decision.monitoring_notes, decision.decided_at::text,
             run.input_payload, run.output AS risk_output, to_jsonb(record) AS rebalance_record,
             execution.id::text AS execution_id, execution.executed_at::text,
             execution.broker_reference, execution.actual_weights
      FROM investment_decision decision
      JOIN calculation_run run ON run.id = decision.calculation_run_id
      LEFT JOIN rebalance_record record ON record.decision_id = decision.id
      LEFT JOIN execution_record execution ON execution.decision_id = decision.id
      ORDER BY decision.decided_at DESC, decision.recorded_at DESC
      LIMIT ${Math.max(1, Math.min(100, limit))}
    `;
    return rows.map((row) => ({
      id: row.id,
      calculationRunId: row.calculation_run_id,
      triggerType: row.trigger_type as DecisionJournalEntry["triggerType"],
      outcome: row.outcome as DecisionJournalEntry["outcome"],
      rationale: row.rationale,
      monitoringNotes: row.monitoring_notes,
      decidedAt: new Date(row.decided_at).toISOString(),
      targetInput: row.input_payload,
      riskOutput: row.risk_output,
      rebalanceRecord: row.rebalance_record,
      execution: row.execution_id && row.executed_at && row.broker_reference ? {
        id: row.execution_id,
        executedAt: new Date(row.executed_at).toISOString(),
        brokerReference: row.broker_reference,
        actualWeights: row.actual_weights,
      } : null,
    }));
  }
}
