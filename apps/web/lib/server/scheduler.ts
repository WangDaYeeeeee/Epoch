import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { calculateDemoLedger } from "./demo-ledger";

type ScheduledJob = { id: string; handler: string; interval_seconds: number };

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

const handlers: Record<string, (sql: Sql) => Promise<void>> = {
  "demo-ledger-recalculation": runDemoLedgerCalculation,
};

export async function runDueJobs(sql: Sql): Promise<Array<{ id: string; status: "succeeded" | "failed" | "skipped" }>> {
  const jobs = await sql<ScheduledJob[]>`
    SELECT id, handler, interval_seconds
    FROM scheduled_job
    WHERE enabled = true AND next_run_at <= now()
    ORDER BY next_run_at, id
  `;
  const results: Array<{ id: string; status: "succeeded" | "failed" | "skipped" }> = [];
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
      await handler(connection);
      await connection`
        UPDATE scheduled_job
        SET last_finished_at = now(), last_status = 'succeeded', last_error = NULL,
            next_run_at = now() + (${job.interval_seconds} * interval '1 second'), updated_at = now()
        WHERE id = ${job.id}
      `;
      results.push({ id: job.id, status: "succeeded" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown scheduler error";
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
