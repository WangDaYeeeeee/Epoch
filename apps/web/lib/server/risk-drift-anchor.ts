import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import type { CalculationRunRecord } from "./calculation-run";

export type RiskDriftAnchor = {
  id: string;
  calculationRunId: string;
  effectiveAt: string;
  portfolioVolatilityAnnualized: number;
  note: string | null;
  instruments: {
    instrumentId: string;
    weight: number;
    volatilityAnnualized: number;
    riskContribution: number | null;
  }[];
};

type AnchorRow = {
  id: string;
  calculation_run_id: string;
  effective_at: string;
  portfolio_volatility_annualized: string;
  note: string | null;
  instrument_id: string | null;
  weight: string | null;
  volatility_annualized: string | null;
  risk_contribution: string | null;
};

const outputRisk = (run: CalculationRunRecord) => {
  if (!run.response || !["succeeded", "degraded"].includes(run.status)) {
    throw new Error("Risk anchor requires a completed calculation run");
  }
  if (!["portfolio-risk", "portfolio-risk-rebalance"].includes(run.calculationType)) {
    throw new Error("Risk anchor requires a portfolio risk calculation");
  }
  const output = run.response.output as {
    portfolio?: { volatilityAnnualized?: number };
    instruments?: { instrumentId?: string; weight?: number; volatilityAnnualized?: number; riskContribution?: number }[];
  };
  if (
    !Number.isFinite(output.portfolio?.volatilityAnnualized)
    || !Array.isArray(output.instruments)
    || output.instruments.some((item) =>
      typeof item.instrumentId !== "string"
      || !Number.isFinite(item.weight)
      || !Number.isFinite(item.volatilityAnnualized)
      || !Number.isFinite(item.riskContribution))
  ) throw new Error("Calculation run does not contain a valid risk output");
  return {
    portfolioVolatilityAnnualized: output.portfolio!.volatilityAnnualized!,
    instruments: output.instruments as {
      instrumentId: string;
      weight: number;
      volatilityAnnualized: number;
      riskContribution: number;
    }[],
  };
};

const groupAnchor = (rows: AnchorRow[]): RiskDriftAnchor | null => {
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    calculationRunId: rows[0].calculation_run_id,
    effectiveAt: new Date(rows[0].effective_at).toISOString(),
    portfolioVolatilityAnnualized: Number(rows[0].portfolio_volatility_annualized),
    note: rows[0].note,
    instruments: rows.flatMap((row) => row.instrument_id == null ? [] : [{
      instrumentId: row.instrument_id,
      weight: Number(row.weight),
      volatilityAnnualized: Number(row.volatility_annualized),
      riskContribution: row.risk_contribution == null ? null : Number(row.risk_contribution),
    }]),
  };
};

export class PostgresRiskDriftAnchorRepository {
  constructor(private readonly sql: Sql) {}

  async create(run: CalculationRunRecord, note?: string): Promise<RiskDriftAnchor> {
    const risk = outputRisk(run);
    const id = randomUUID();
    await this.sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO risk_drift_anchor (
          id, calculation_run_id, effective_at, portfolio_volatility_annualized, note
        ) VALUES (
          ${id}, ${run.id}, ${run.asOf}, ${risk.portfolioVolatilityAnnualized}, ${note ?? null}
        )
        ON CONFLICT (calculation_run_id) DO NOTHING
      `;
      const [anchor] = await transaction<{ id: string }[]>`
        SELECT id::text FROM risk_drift_anchor WHERE calculation_run_id = ${run.id}
      `;
      if (!anchor) throw new Error("Risk drift anchor could not be created");
      for (const instrument of risk.instruments) {
        await transaction`
          INSERT INTO risk_drift_anchor_instrument (
            anchor_id, instrument_id, weight, volatility_annualized, risk_contribution
          ) VALUES (
            ${anchor.id}, ${instrument.instrumentId}, ${instrument.weight}, ${instrument.volatilityAnnualized},
            ${instrument.riskContribution}
          )
          ON CONFLICT (anchor_id, instrument_id) DO NOTHING
        `;
      }
    });
    const anchor = await this.loadByRun(run.id);
    if (!anchor) throw new Error("Risk drift anchor could not be loaded");
    return anchor;
  }

  async loadLatest(): Promise<RiskDriftAnchor | null> {
    const rows = await this.sql<AnchorRow[]>`
      SELECT anchor.id::text, anchor.calculation_run_id::text, anchor.effective_at::text,
             anchor.portfolio_volatility_annualized::text, anchor.note,
             instrument.instrument_id, instrument.weight::text, instrument.volatility_annualized::text,
             instrument.risk_contribution::text
      FROM risk_drift_anchor anchor
      LEFT JOIN risk_drift_anchor_instrument instrument ON instrument.anchor_id = anchor.id
      WHERE anchor.id = (
        SELECT id FROM risk_drift_anchor ORDER BY effective_at DESC, created_at DESC, id DESC LIMIT 1
      )
      ORDER BY instrument.instrument_id
    `;
    return groupAnchor(rows);
  }

  async loadByRun(calculationRunId: string): Promise<RiskDriftAnchor | null> {
    const rows = await this.sql<AnchorRow[]>`
      SELECT anchor.id::text, anchor.calculation_run_id::text, anchor.effective_at::text,
             anchor.portfolio_volatility_annualized::text, anchor.note,
             instrument.instrument_id, instrument.weight::text, instrument.volatility_annualized::text,
             instrument.risk_contribution::text
      FROM risk_drift_anchor anchor
      LEFT JOIN risk_drift_anchor_instrument instrument ON instrument.anchor_id = anchor.id
      WHERE anchor.calculation_run_id = ${calculationRunId}
      ORDER BY instrument.instrument_id
    `;
    return groupAnchor(rows);
  }
}
