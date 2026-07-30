import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Sql } from "postgres";
import { buildPortfolioRiskInput } from "../domain/risk-input";
import { parseCsv } from "./csv";
import {
  createCalculationRequest,
  executeRecordedCalculation,
  PostgresCalculationRunRepository,
} from "./calculation-run";
import { resolveDataRoot } from "./portfolio";
import { riskCodeVersion } from "./risk-code-version";
import { canonicalBrokerPositionInstrumentId } from "../domain/market-data";

type Row = Record<string, string>;

export function preparePortfolioRiskCalculation(root = resolveDataRoot()) {
  if (!root) throw new Error("Private baseline data is unavailable");
  const positions = parseCsv(readFileSync(resolve(root, "normalized/positions.csv"), "utf8"));
  const bars = parseCsv(readFileSync(resolve(root, "normalized/market-bars.csv"), "utf8"));
  const payload = buildPortfolioRiskInput(positions, bars);
  return createCalculationRequest({
    calculationType: "portfolio-risk",
    asOf: payload.asOf,
    codeVersion: riskCodeVersion(),
    strategyVersion: "epoch-satellite-v0.1.0",
    parameterSetVersion: "default-draft-v0.1.0",
    payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
  });
}

export async function prepareCurrentPortfolioRiskCalculation(sql: Sql, root = resolveDataRoot()) {
  if (!root) throw new Error("Private baseline data is unavailable");
  const accountId = process.env.IBKR_FLEX_ACCOUNT_ID?.trim() || "ibkr_8602";
  const positions = await sql<Row[]>`
    SELECT snapshot_date::text AS date, instrument_id, ticker, category,
           quantity::text, market_value::text, currency,
           COALESCE(market_value_base::text, '') AS market_value_base,
           COALESCE(fx_to_base::text, '') AS fx_to_base
    FROM reported_position_snapshot
    WHERE account_id = ${accountId}
      AND source LIKE 'ibkr_flex:%'
      AND snapshot_date = (
        SELECT max(snapshot_date)
        FROM reported_position_snapshot
        WHERE account_id = ${accountId} AND source LIKE 'ibkr_flex:%'
      )
    ORDER BY instrument_id
  `;
  if (!positions.length) return preparePortfolioRiskCalculation(root);
  const [nav] = await sql<{ nav: string }[]>`
    SELECT nav::text
    FROM ibkr_account_nav_snapshot
    WHERE account_id = ${accountId}
    ORDER BY snapshot_date DESC, observed_at DESC
    LIMIT 1
  `;
  if (!nav) throw new Error("Current IBKR risk input has no matching NAV");
  const normalizedPositions = positions.map((row) => ({
    ...row,
    instrument_id: canonicalBrokerPositionInstrumentId({
      instrumentId: row.instrument_id,
      symbol: row.ticker,
      currency: row.currency,
      assetClass: row.category,
    }),
  }));
  const bars = parseCsv(readFileSync(resolve(root, "normalized/market-bars.csv"), "utf8"));
  const payload = buildPortfolioRiskInput(normalizedPositions, bars, Number(nav.nav));
  return createCalculationRequest({
    calculationType: "portfolio-risk",
    asOf: payload.asOf,
    codeVersion: riskCodeVersion(),
    strategyVersion: "epoch-satellite-v0.1.0",
    parameterSetVersion: "default-draft-v0.1.0",
    payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
  });
}

export async function runPortfolioRiskIfChanged(sql: Sql): Promise<"succeeded" | "skipped"> {
  const request = await prepareCurrentPortfolioRiskCalculation(sql);
  const repository = new PostgresCalculationRunRepository(sql);
  const latest = await repository.loadLatestCompleted("portfolio-risk");
  if (
    latest
    && latest.asOf === new Date(request.asOf).toISOString()
    && latest.inputHash === request.inputHash
    && latest.codeVersion === request.codeVersion
  ) return "skipped";
  await executeRecordedCalculation(repository, request);
  return "succeeded";
}
