import { createDatabaseClient, migrateDatabase } from "../lib/server/database";
import { preparePortfolioRiskCalculation } from "../lib/server/portfolio-risk-runner";
import { executeRecordedCalculation, PostgresCalculationRunRepository } from "../lib/server/calculation-run";

async function main(): Promise<void> {
  const request = preparePortfolioRiskCalculation();

  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const response = await executeRecordedCalculation(new PostgresCalculationRunRepository(sql), request);
    const output = response.output as {
      portfolio?: {
        volatilityAnnualized?: number;
        stressVolatilityAnnualized?: number;
        historicalCvarLoss?: number;
      };
      policyGate?: { passed?: boolean; limitAnnualized?: number };
    };
    console.log(JSON.stringify({
      calculationId: response.calculationId,
      inputHash: response.inputHash,
      codeVersion: request.codeVersion,
      asOf: response.asOf,
      status: response.status,
      modelVersion: response.modelVersion,
      portfolio: output.portfolio,
      policyGate: output.policyGate,
    }, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
