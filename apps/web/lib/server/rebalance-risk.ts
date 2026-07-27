import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildRebalanceRiskInput, type RebalanceTargetWeight } from "../domain/rebalance-intent";
import { buildPortfolioRiskInput } from "../domain/risk-input";
import { createCalculationRequest, executeRecordedCalculation, PostgresCalculationRunRepository } from "./calculation-run";
import { parseCsv } from "./csv";
import { createDatabaseClient } from "./database";
import { resolveDataRoot } from "./portfolio";
import { riskCodeVersion } from "./risk-code-version";

export async function evaluateRebalanceRisk(targetWeights: RebalanceTargetWeight[]) {
  const dataRoot = resolveDataRoot();
  if (!dataRoot) throw new Error("Risk input is unavailable");
  const positions = parseCsv(readFileSync(resolve(dataRoot, "normalized/positions.csv"), "utf8"));
  const bars = parseCsv(readFileSync(resolve(dataRoot, "normalized/market-bars.csv"), "utf8"));
  const current = buildPortfolioRiskInput(positions, bars);
  const payload = buildRebalanceRiskInput(current, targetWeights);
  const calculation = createCalculationRequest({
    calculationType: "portfolio-risk-rebalance",
    asOf: payload.asOf,
    codeVersion: riskCodeVersion(),
    strategyVersion: "epoch-satellite-v0.1.0",
    parameterSetVersion: "default-draft-v0.1.0",
    payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
  });
  const sql = createDatabaseClient();
  try {
    return await executeRecordedCalculation(new PostgresCalculationRunRepository(sql), calculation);
  } finally {
    await sql.end();
  }
}
