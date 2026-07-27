import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { buildRebalanceRiskInput, RebalanceIntentError, type RebalanceTargetWeight } from "@/lib/domain/rebalance-intent";
import { buildPortfolioRiskInput } from "@/lib/domain/risk-input";
import { createCalculationRequest, executeRecordedCalculation, PostgresCalculationRunRepository } from "@/lib/server/calculation-run";
import { parseCsv } from "@/lib/server/csv";
import { createDatabaseClient } from "@/lib/server/database";
import { resolveDataRoot } from "@/lib/server/portfolio";
import { riskCodeVersion } from "@/lib/server/risk-code-version";

export const dynamic = "force-dynamic";

const targetWeights = (body: unknown): RebalanceTargetWeight[] => {
  if (typeof body !== "object" || body === null || !Array.isArray((body as Record<string, unknown>).targetWeights)) {
    throw new RebalanceIntentError("Request must contain targetWeights");
  }
  return (body as { targetWeights: unknown[] }).targetWeights.map((item) => {
    if (
      typeof item !== "object" || item === null
      || typeof (item as Record<string, unknown>).instrumentId !== "string"
      || typeof (item as Record<string, unknown>).weight !== "number"
    ) throw new RebalanceIntentError("Each target weight requires instrumentId and numeric weight");
    return item as RebalanceTargetWeight;
  });
};

export async function POST(request: Request) {
  let weights: RebalanceTargetWeight[];
  try {
    weights = targetWeights(await request.json());
  } catch (error) {
    return NextResponse.json({
      error: "invalid_rebalance_intent",
      detail: error instanceof Error ? error.message : "Invalid JSON request",
    }, { status: 422 });
  }

  const dataRoot = resolveDataRoot();
  if (!dataRoot) return NextResponse.json({ error: "risk_input_unavailable" }, { status: 503 });
  try {
    const positions = parseCsv(readFileSync(resolve(dataRoot, "normalized/positions.csv"), "utf8"));
    const bars = parseCsv(readFileSync(resolve(dataRoot, "normalized/market-bars.csv"), "utf8"));
    const current = buildPortfolioRiskInput(positions, bars);
    const payload = buildRebalanceRiskInput(current, weights);
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
      const response = await executeRecordedCalculation(new PostgresCalculationRunRepository(sql), calculation);
      return NextResponse.json(response);
    } finally {
      await sql.end();
    }
  } catch (error) {
    if (error instanceof RebalanceIntentError) {
      return NextResponse.json({ error: "invalid_rebalance_intent", detail: error.message }, { status: 422 });
    }
    return NextResponse.json({
      error: "rebalance_risk_unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503 });
  }
}
