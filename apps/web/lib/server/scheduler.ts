import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { calculateDemoLedger } from "./demo-ledger";
import { runMarketDataFreshnessMonitor } from "./market-data-monitor";
import { runPortfolioRiskIfChanged } from "./portfolio-risk-runner";
import { PostgresQualityMetricsRepository } from "./quality-metrics";
import { runIbkrFlexSync } from "./ibkr-flex-sync";
import { runNasdaq100BenchmarkSync } from "./benchmark-sync";
import { runDailyDataRefresh } from "./daily-data-refresh";

type ScheduledJob = { id: string; handler: string; interval_seconds: number };
type JobStatus = "succeeded" | "failed" | "skipped";

async function runDemoLedgerCalculation(sql: Sql): Promise<void> {
  const calculation = calculateDemoLedger();
  const latest = calculation.snapshots.at(-1)!;
  const asOf = `${latest.date}T23:59:59Z`;
  await sql`
    INSERT INTO calculation_run (
      id, calculation_type, as_of, input_hash, code_version,
      strategy_version_id, parameter_set_id, status, output, finished_at
    ) VALUES (
      ${randomUUID()}, 'demo-ledger', ${asOf}, ${calculation.inputHash},
      ${process.env.EPOCH_CODE_VERSION ?? "phase0"}, 'epoch-satellite-v0.1.0',
      'default-draft-v0.1.0', 'succeeded', ${sql.json(calculation)}, now()
    )
    ON CONFLICT (calculation_type, as_of, input_hash, code_version)
    DO UPDATE SET output = EXCLUDED.output, status = 'succeeded', finished_at = now(), failure_reason = NULL
  `;
}

const handlers: Record<string, (sql: Sql) => Promise<"succeeded" | "skipped" | void>> = {
  "demo-ledger-recalculation": async (sql) => {
    if (process.env.NODE_ENV === "production") return "skipped";
    await runDemoLedgerCalculation(sql);
  },
  "market-data-freshness-monitor": runMarketDataFreshnessMonitor,
  "portfolio-risk-refresh": runPortfolioRiskIfChanged,
  "quality-metrics-refresh": async (sql) => {
    await new PostgresQualityMetricsRepository(sql).evaluateMaturedForecasts();
  },
  "ibkr-flex-sync": async (sql) => (await runIbkrFlexSync(sql)).status,
  "nasdaq100-benchmark-sync": async (sql) => (await runNasdaq100BenchmarkSync(sql)).status,
  "daily-data-refresh": async (sql) => (await runDailyDataRefresh(sql, { trigger: "scheduled" })).status,
};

async function resolveJobAlerts(sql: Sql, jobId: string): Promise<void> {
  await sql`
    UPDATE operational_alert
    SET status = 'resolved', resolved_at = now()
    WHERE source = ${`scheduled_job:${jobId}`} AND status = 'open'
  `;
}

async function recordJobFailure(sql: Sql, jobId: string, message: string): Promise<void> {
  await sql`
    INSERT INTO operational_alert (
      id, source, fingerprint, severity, status, title, detail
    ) VALUES (
      ${randomUUID()}, ${`scheduled_job:${jobId}`}, 'execution-failure', 'error', 'open',
      ${`Scheduled job failed: ${jobId}`}, ${message}
    )
    ON CONFLICT (source, fingerprint) DO UPDATE
    SET severity = 'error', status = 'open', detail = EXCLUDED.detail,
        occurrence_count = operational_alert.occurrence_count + 1,
        last_observed_at = now(), resolved_at = NULL
  `;
}

export async function runDueJobs(sql: Sql): Promise<Array<{ id: string; status: JobStatus }>> {
  const jobs = await sql<ScheduledJob[]>`
    SELECT id, handler, interval_seconds
    FROM scheduled_job
    WHERE enabled = true AND next_run_at <= now()
    ORDER BY next_run_at, id
  `;
  const results: Array<{ id: string; status: JobStatus }> = [];
  for (const job of jobs) {
    const connection = await sql.reserve();
    try {
      const [lock] = await connection<{ acquired: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${job.id})) AS acquired`;
      if (!lock?.acquired) {
        results.push({ id: job.id, status: "skipped" });
        continue;
      }
      const handler = handlers[job.handler];
      if (!handler) throw new Error(`Unknown scheduled job handler: ${job.handler}`);
      await connection`UPDATE scheduled_job SET last_started_at = now(), updated_at = now() WHERE id = ${job.id}`;
      // Keep the advisory lock on its dedicated reserved connection, but run
      // the handler through the pool. Reserved postgres.js connections do not
      // expose transaction helpers at runtime, while import handlers need
      // sql.begin() for atomic persistence.
      const outcome = await handler(sql);
      const status = outcome ?? "succeeded";
      await resolveJobAlerts(connection, job.id);
      await connection`
        UPDATE scheduled_job
        SET last_finished_at = now(), last_status = ${status}, last_error = NULL,
            next_run_at = now() + (${job.interval_seconds} * interval '1 second'), updated_at = now()
        WHERE id = ${job.id}
      `;
      results.push({ id: job.id, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown scheduler error";
      await recordJobFailure(connection, job.id, message);
      await connection`
        UPDATE scheduled_job
        SET last_finished_at = now(), last_status = 'failed', last_error = ${message},
            next_run_at = now() + (${job.interval_seconds} * interval '1 second'), updated_at = now()
        WHERE id = ${job.id}
      `;
      results.push({ id: job.id, status: "failed" });
    } finally {
      await connection`SELECT pg_advisory_unlock(hashtext(${job.id}))`;
      connection.release();
    }
  }
  return results;
}
