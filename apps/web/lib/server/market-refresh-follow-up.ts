import type { Sql } from "postgres";
import { runMarketDataFreshnessMonitor } from "./market-data-monitor";
import { runPortfolioRiskIfChanged } from "./portfolio-risk-runner";
import { PostgresQualityMetricsRepository } from "./quality-metrics";

export type MarketRefreshFollowUp = {
  freshness: "succeeded";
  risk: "succeeded" | "skipped";
  qualityEvaluationsInserted: number;
};

/**
 * Rebuild data-derived outputs immediately after a successful daily-bar refresh.
 * Scheduled jobs remain as fallbacks for refreshes performed outside this app.
 */
export async function runMarketRefreshFollowUp(sql: Sql): Promise<MarketRefreshFollowUp> {
  const freshness = await runMarketDataFreshnessMonitor(sql);
  const risk = await runPortfolioRiskIfChanged(sql);
  const qualityEvaluationsInserted = await new PostgresQualityMetricsRepository(sql)
    .evaluateMaturedForecasts();
  await sql`
    UPDATE scheduled_job
    SET next_run_at = now() + (interval_seconds * interval '1 second'),
        updated_at = now()
    WHERE id IN (
      'market-data-freshness-monitor',
      'portfolio-risk-refresh',
      'quality-metrics-refresh'
    )
  `;
  return { freshness, risk, qualityEvaluationsInserted };
}
