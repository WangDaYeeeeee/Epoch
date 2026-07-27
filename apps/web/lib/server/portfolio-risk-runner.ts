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

export async function runPortfolioRiskIfChanged(sql: Sql): Promise<"succeeded" | "skipped"> {
  const request = preparePortfolioRiskCalculation();
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
