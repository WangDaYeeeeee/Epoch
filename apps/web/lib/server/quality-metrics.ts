import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import { oneStepVarianceEvaluation, validateClaimOutcome, type ClaimOutcome } from "../domain/quality-metrics";
import { canonicalMarketInstrumentId } from "../domain/market-data";
import { parseCsv } from "./csv";
import { resolveDataRoot } from "./portfolio";

type ForecastRow = {
  calculation_run_id: string;
  forecast_as_of: string;
  forecasts: { instrumentId: string; varianceDaily: number }[];
};

export class PostgresQualityMetricsRepository {
  constructor(private readonly sql: Sql) {}

  async evaluateMaturedForecasts(root = resolveDataRoot()): Promise<number> {
    if (!root) throw new Error("Market data root is unavailable");
    const bars = parseCsv(readFileSync(resolve(root, "normalized/market-bars.csv"), "utf8"));
    const byInstrument = new Map<string, { date: string; close: number; source: string }[]>();
    for (const row of bars) {
      const instrumentId = canonicalMarketInstrumentId(row.instrument_id);
      const values = byInstrument.get(instrumentId) ?? [];
      values.push({ date: row.date, close: Number(row.close), source: row.source });
      byInstrument.set(instrumentId, values);
    }
    for (const values of byInstrument.values()) values.sort((left, right) => left.date.localeCompare(right.date));
    const runs = await this.sql<ForecastRow[]>`
      SELECT id::text AS calculation_run_id, as_of::date::text AS forecast_as_of,
             diagnostics->'forecasts' AS forecasts
      FROM calculation_run
      WHERE calculation_type = 'portfolio-risk'
        AND status IN ('succeeded', 'degraded')
        AND jsonb_typeof(diagnostics->'forecasts') = 'array'
      ORDER BY as_of
    `;
    let inserted = 0;
    for (const run of runs) {
      for (const forecast of run.forecasts) {
        const values = byInstrument.get(canonicalMarketInstrumentId(forecast.instrumentId)) ?? [];
        const previous = [...values].reverse().find((item) => item.date <= run.forecast_as_of);
        const realized = values.find((item) => item.date > run.forecast_as_of);
        if (!previous || !realized) continue;
        const evaluation = oneStepVarianceEvaluation({
          predictedVariance: forecast.varianceDaily,
          previousClose: previous.close,
          realizedClose: realized.close,
        });
        const rows = await this.sql<{ id: string }[]>`
          INSERT INTO forecast_evaluation (
            id, calculation_run_id, instrument_id, forecast_as_of, realized_as_of,
            horizon_trading_days, predicted_variance, realized_return, realized_variance,
            error, absolute_error, squared_error, market_source
          ) VALUES (
            ${randomUUID()}, ${run.calculation_run_id}, ${forecast.instrumentId},
            ${run.forecast_as_of}, ${realized.date}, 1, ${evaluation.predictedVariance},
            ${evaluation.realizedReturn}, ${evaluation.realizedVariance}, ${evaluation.error},
            ${evaluation.absoluteError}, ${evaluation.squaredError}, ${realized.source}
          )
          ON CONFLICT (calculation_run_id, instrument_id, horizon_trading_days) DO NOTHING
          RETURNING id::text
        `;
        inserted += rows.length;
      }
    }
    return inserted;
  }

  async recordClaimOutcome(input: {
    claimId: string;
    outcome: ClaimOutcome;
    evaluatedAsOf: string;
    rationale: string;
    evidenceId?: string | null;
  }): Promise<string> {
    const outcome = validateClaimOutcome(input.outcome);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.evaluatedAsOf)) throw new Error("Claim outcome requires an ISO date");
    const rationale = input.rationale.trim();
    if (!rationale) throw new Error("Claim outcome rationale is required");
    const id = randomUUID();
    const rows = await this.sql<{ id: string }[]>`
      INSERT INTO claim_outcome (
        id, claim_id, outcome, evaluated_as_of, rationale, evidence_id
      ) SELECT
        ${id}, claim.id, ${outcome}, ${input.evaluatedAsOf}, ${rationale}, evidence.id
      FROM research_claim claim
      LEFT JOIN research_evidence evidence ON evidence.id = ${input.evidenceId ?? null}
      WHERE claim.id = ${input.claimId}
        AND (${input.evidenceId ?? null}::uuid IS NULL OR evidence.id IS NOT NULL)
      ON CONFLICT (claim_id, evaluated_as_of) DO UPDATE
      SET outcome = EXCLUDED.outcome, rationale = EXCLUDED.rationale, evidence_id = EXCLUDED.evidence_id
      RETURNING id::text
    `;
    if (!rows[0]) throw new Error("Claim or outcome evidence not found");
    return rows[0].id;
  }

  async loadDashboard() {
    const [forecast, confidence, unresolved, playbooks, decisions] = await Promise.all([
      this.sql`
        SELECT count(*)::int AS observations,
               avg(absolute_error)::float8 AS mae,
               sqrt(avg(squared_error))::float8 AS rmse,
               max(realized_as_of)::text AS latest_realized_as_of
        FROM forecast_evaluation
      `,
      this.sql`
        SELECT width_bucket(claim.confidence, 0, 1, 10) AS confidence_bucket,
               count(*)::int AS observations,
               avg(CASE WHEN outcome.outcome = 'verified_true' THEN 1.0 ELSE 0.0 END)::float8 AS verified_rate
        FROM claim_outcome outcome
        JOIN research_claim claim ON claim.id = outcome.claim_id
        WHERE outcome.outcome IN ('verified_true', 'verified_false')
        GROUP BY confidence_bucket ORDER BY confidence_bucket
      `,
      this.sql`
        SELECT claim.id::text, claim.candidate_id::text, claim.kind, claim.statement,
               claim.confidence::float8, claim.as_of::text,
               (current_date - claim.as_of)::int AS age_days
        FROM research_claim claim
        WHERE NOT EXISTS (SELECT 1 FROM claim_outcome outcome WHERE outcome.claim_id = claim.id)
        ORDER BY claim.as_of, claim.id LIMIT 100
      `,
      this.sql`
        SELECT count(*) FILTER (WHERE event.status = 'completed')::int AS completed_events,
               count(*) FILTER (
                 WHERE event.status = 'completed' AND playbook.status = 'ready'
                   AND playbook.recorded_at::date <= event.scheduled_date
               )::int AS covered_events
        FROM investment_event event
        LEFT JOIN event_playbook playbook ON playbook.event_id = event.id
      `,
      this.sql`
        SELECT count(*)::int AS decisions,
               count(*) FILTER (WHERE decision.outcome = 'rejected')::int AS rejected,
               count(execution.id)::int AS executed
        FROM investment_decision decision
        LEFT JOIN execution_record execution ON execution.decision_id = decision.id
      `,
    ]);
    return {
      forecast: forecast[0],
      confidenceCalibration: confidence,
      unresolvedClaims: unresolved,
      playbookCoverage: playbooks[0],
      decisionQuality: decisions[0],
    };
  }
}
