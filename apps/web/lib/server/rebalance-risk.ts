import { buildRebalanceRiskInput, type RebalanceTargetWeight } from "../domain/rebalance-intent";
import { createCalculationRequest, executeRecordedCalculation, PostgresCalculationRunRepository } from "./calculation-run";
import { createDatabaseClient } from "./database";
import { prepareCurrentPortfolioRiskCalculation } from "./portfolio-risk-runner";
import { riskCodeVersion } from "./risk-code-version";

export async function evaluateRebalanceRisk(targetWeights: RebalanceTargetWeight[]) {
  const sql = createDatabaseClient();
  try {
    const currentRequest = await prepareCurrentPortfolioRiskCalculation(sql);
    const payload = buildRebalanceRiskInput(
      currentRequest.payload as unknown as Parameters<typeof buildRebalanceRiskInput>[0],
      targetWeights,
    );
    const calculation = createCalculationRequest({
      calculationType: "portfolio-risk-rebalance",
      asOf: payload.asOf,
      codeVersion: riskCodeVersion(),
      strategyVersion: "epoch-satellite-v0.1.0",
      parameterSetVersion: "default-draft-v0.1.0",
      payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>,
    });
    return await executeRecordedCalculation(new PostgresCalculationRunRepository(sql), calculation);
  } finally {
    await sql.end();
  }
}
