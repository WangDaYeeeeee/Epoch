import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { fetchFredBenchmark, type FredObservation } from "../connectors/fred-benchmark";

const BENCHMARK_ID = ".NDX";
const SERIES_ID = "NASDAQ100";

export type BenchmarkSyncResult = {
  status: "succeeded" | "skipped";
  observationsUpserted?: number;
  latestObservationDate?: string;
  latestSuccessfulSyncAt?: string;
  reason?: string;
};

async function resolveBenchmarkSyncAlert(sql: Sql): Promise<void> {
  await sql`
    UPDATE operational_alert
    SET status = 'resolved', resolved_at = now()
    WHERE source = 'scheduled_job:nasdaq100-benchmark-sync' AND status = 'open'
  `;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBefore(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

export async function runNasdaq100BenchmarkSync(
  sql: Sql,
  dependencies: {
    fetchObservations?: typeof fetchFredBenchmark;
    now?: Date;
  } = {},
): Promise<BenchmarkSyncResult> {
  if (process.env.NASDAQ100_SYNC_ENABLED === "false") {
    return { status: "skipped", reason: "NASDAQ-100 benchmark sync is disabled" };
  }
  const now = dependencies.now ?? new Date();
  const [latest] = await sql<{ effective_date: string }[]>`
    SELECT effective_date::text
    FROM benchmark_observation
    WHERE benchmark_id = ${BENCHMARK_ID} AND source = 'fred:NASDAQ100'
    ORDER BY effective_date DESC
    LIMIT 1
  `;
  const startDate = latest
    ? isoDate(daysBefore(new Date(`${latest.effective_date}T00:00:00Z`), 14))
    : isoDate(daysBefore(now, 370));
  const runId = randomUUID();
  await sql`
    INSERT INTO benchmark_sync_run (id, benchmark_id, provider, status)
    VALUES (${runId}, ${BENCHMARK_ID}, 'fred', 'running')
  `;
  try {
    const observations = await (dependencies.fetchObservations ?? fetchFredBenchmark)({
      seriesId: SERIES_ID,
      baseUrl: process.env.FRED_CSV_BASE_URL?.trim() || undefined,
      startDate,
      endDate: isoDate(now),
      timeoutMs: Number(process.env.FRED_TIMEOUT_MS ?? 30_000),
    });
    const observedAt = now.toISOString();
    await sql.begin(async (transaction) => {
      for (const observation of observations) {
        await transaction`
          INSERT INTO benchmark_observation (
            benchmark_id, effective_date, close, source, observed_at
          ) VALUES (
            ${BENCHMARK_ID}, ${observation.date}, ${observation.close}, 'fred:NASDAQ100', ${observedAt}
          )
          ON CONFLICT (benchmark_id, effective_date, source) DO UPDATE
          SET close = EXCLUDED.close, observed_at = EXCLUDED.observed_at, recorded_at = now()
        `;
      }
    });
    const latestObservationDate = observations.map((row) => row.date).sort().at(-1)!;
    await sql`
      UPDATE benchmark_sync_run
      SET status = 'succeeded', observations_upserted = ${observations.length},
          latest_observation_date = ${latestObservationDate}, finished_at = now()
      WHERE id = ${runId}
    `;
    await resolveBenchmarkSyncAlert(sql);
    return { status: "succeeded", observationsUpserted: observations.length, latestObservationDate };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown benchmark sync error";
    await sql`
      UPDATE benchmark_sync_run
      SET status = 'failed', failure_reason = ${message}, finished_at = now()
      WHERE id = ${runId}
    `;
    throw error;
  }
}

async function deferScheduledSync(sql: Sql): Promise<void> {
  await sql`
    UPDATE scheduled_job
    SET next_run_at = now() + (interval_seconds * interval '1 second'), updated_at = now()
    WHERE id = 'nasdaq100-benchmark-sync'
  `;
}

export async function ensureNasdaq100BenchmarkFresh(
  sql: Sql,
  dependencies: {
    fetchObservations?: (config: Parameters<typeof fetchFredBenchmark>[0]) => Promise<FredObservation[]>;
    now?: Date;
    maxAgeHours?: number;
  } = {},
): Promise<BenchmarkSyncResult> {
  if (process.env.NASDAQ100_SYNC_ENABLED === "false") {
    return { status: "skipped", reason: "NASDAQ-100 benchmark sync is disabled" };
  }
  const now = dependencies.now ?? new Date();
  const maxAgeHours = dependencies.maxAgeHours
    ?? Number(process.env.NASDAQ100_STARTUP_MAX_AGE_HOURS ?? 20);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("NASDAQ100_STARTUP_MAX_AGE_HOURS must be a positive number");
  }
  const [latest] = await sql<{ finished_at: string }[]>`
    SELECT finished_at::text
    FROM benchmark_sync_run
    WHERE benchmark_id = ${BENCHMARK_ID} AND provider = 'fred'
      AND status = 'succeeded' AND finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  const latestSuccessfulSyncAt = latest ? new Date(latest.finished_at).toISOString() : undefined;
  if (latestSuccessfulSyncAt
    && now.valueOf() - new Date(latestSuccessfulSyncAt).valueOf() <= maxAgeHours * 3_600_000) {
    await deferScheduledSync(sql);
    await resolveBenchmarkSyncAlert(sql);
    return {
      status: "skipped",
      reason: `latest successful NASDAQ-100 sync is within ${maxAgeHours} hours`,
      latestSuccessfulSyncAt,
    };
  }
  const result = await runNasdaq100BenchmarkSync(sql, {
    fetchObservations: dependencies.fetchObservations,
    now,
  });
  await deferScheduledSync(sql);
  return { ...result, latestSuccessfulSyncAt };
}
