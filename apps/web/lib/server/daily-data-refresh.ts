import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { runNasdaq100BenchmarkSync, type BenchmarkSyncResult } from "./benchmark-sync";
import { runIbkrFlexSync, type IbkrFlexSyncResult } from "./ibkr-flex-sync";
import {
  currentFlexMarketInstrumentIds,
  executeMarketRefresh,
  marketRefreshPreflight,
  type MarketRefreshPreflight,
} from "./market-refresh";
import { runMarketRefreshFollowUp, type MarketRefreshFollowUp } from "./market-refresh-follow-up";

export type DailyDataRefreshResult = {
  status: "succeeded";
  runId: string;
  observedAt: string;
  account: IbkrFlexSyncResult;
  benchmark: BenchmarkSyncResult;
  market: Record<string, unknown>;
  followUp: MarketRefreshFollowUp;
};

export type DailyDataFreshnessResult = DailyDataRefreshResult | {
  status: "skipped";
  reason: string;
  latestSuccessfulRefreshAt?: string;
};

/**
 * Force-refreshes every daily source exposed by the manual dashboard action.
 * This intentionally does not use freshness gates: explicit user refreshes
 * should contact each configured provider even when a scheduled run was recent.
 */
export async function runDailyDataRefresh(
  sql: Sql,
  dependencies: {
    syncAccount?: typeof runIbkrFlexSync;
    syncBenchmark?: typeof runNasdaq100BenchmarkSync;
    refreshMarket?: typeof executeMarketRefresh;
    runFollowUp?: typeof runMarketRefreshFollowUp;
    now?: Date;
    preflight?: MarketRefreshPreflight;
    trigger?: "manual" | "startup" | "scheduled";
  } = {},
): Promise<DailyDataRefreshResult> {
  if (process.env.EPOCH_DAILY_DATA_SYNC_ENABLED === "false") {
    throw new Error("Unified daily data refresh is disabled");
  }
  const runId = randomUUID();
  const trigger = dependencies.trigger ?? "manual";
  await sql`
    INSERT INTO daily_data_refresh_run (id, trigger, status)
    VALUES (${runId}, ${trigger}, 'running')
  `;
  try {
    const account = await (dependencies.syncAccount ?? runIbkrFlexSync)(sql);
    const benchmark = await (dependencies.syncBenchmark ?? runNasdaq100BenchmarkSync)(sql);
    const preflight = dependencies.preflight ?? marketRefreshPreflight(
      dependencies.now ?? new Date(),
      await currentFlexMarketInstrumentIds(sql),
    );
    const market = await (dependencies.refreshMarket ?? executeMarketRefresh)(preflight);
    const followUp = await (dependencies.runFollowUp ?? runMarketRefreshFollowUp)(sql);
    const result = {
      status: "succeeded" as const,
      runId,
      observedAt: (dependencies.now ?? new Date()).toISOString(),
      account,
      benchmark,
      market,
      followUp,
    };
    await sql`
      UPDATE daily_data_refresh_run
      SET status = 'succeeded', result = ${sql.json(JSON.parse(JSON.stringify(result)))},
          failure_reason = NULL, finished_at = now()
      WHERE id = ${runId}
    `;
    await sql`
      UPDATE scheduled_job
      SET next_run_at = now() + (interval_seconds * interval '1 second'), updated_at = now()
      WHERE id = 'daily-data-refresh'
    `;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown daily data refresh error";
    await sql`
      UPDATE daily_data_refresh_run
      SET status = 'failed', failure_reason = ${message}, finished_at = now()
      WHERE id = ${runId}
    `;
    throw error;
  }
}

export async function ensureDailyDataFresh(
  sql: Sql,
  dependencies: {
    now?: Date;
    maxAgeHours?: number;
  } = {},
): Promise<DailyDataFreshnessResult> {
  if (process.env.EPOCH_DAILY_DATA_SYNC_ENABLED === "false") {
    return { status: "skipped", reason: "Unified daily data refresh is disabled" };
  }
  const now = dependencies.now ?? new Date();
  const maxAgeHours = dependencies.maxAgeHours
    ?? Number(process.env.EPOCH_DAILY_DATA_STARTUP_MAX_AGE_HOURS ?? 20);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("EPOCH_DAILY_DATA_STARTUP_MAX_AGE_HOURS must be a positive number");
  }
  const [latest] = await sql<{ finished_at: string }[]>`
    SELECT finished_at::text
    FROM daily_data_refresh_run
    WHERE status = 'succeeded' AND finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  const latestSuccessfulRefreshAt = latest ? new Date(latest.finished_at).toISOString() : undefined;
  if (
    latestSuccessfulRefreshAt
    && now.valueOf() - new Date(latestSuccessfulRefreshAt).valueOf() <= maxAgeHours * 3_600_000
  ) {
    await sql`
      UPDATE scheduled_job
      SET next_run_at = now() + (interval_seconds * interval '1 second'), updated_at = now()
      WHERE id = 'daily-data-refresh'
    `;
    return {
      status: "skipped",
      reason: `latest successful daily data refresh is within ${maxAgeHours} hours`,
      latestSuccessfulRefreshAt,
    };
  }
  return runDailyDataRefresh(sql, { now, trigger: "startup" });
}
