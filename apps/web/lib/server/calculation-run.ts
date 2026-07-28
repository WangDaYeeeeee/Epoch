import { createHash, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { runAnalyticsCalculation, type AnalyticsCalculationRequest, type AnalyticsCalculationResponse } from "./analytics-client";

export type CalculationRunRecord = {
  id: string;
  calculationType: string;
  asOf: string;
  inputHash: string;
  codeVersion: string;
  status: "running" | "succeeded" | "degraded" | "failed";
  input: Record<string, unknown> | null;
  response: AnalyticsCalculationResponse | null;
  failureReason: string | null;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
};

const databaseJson = (value: unknown): Parameters<Sql["json"]>[0] => JSON.parse(JSON.stringify(value));

export function calculationInputHash(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
}

export function createCalculationRequest(input: {
  calculationType: string;
  asOf: string;
  codeVersion: string;
  payload: Record<string, unknown>;
  strategyVersion?: string | null;
  parameterSetVersion?: string | null;
}): AnalyticsCalculationRequest {
  return {
    contractVersion: "1.0",
    calculationId: randomUUID(),
    calculationType: input.calculationType,
    asOf: input.asOf,
    inputHash: calculationInputHash(input.payload),
    codeVersion: input.codeVersion,
    strategyVersion: input.strategyVersion,
    parameterSetVersion: input.parameterSetVersion,
    payload: input.payload,
  };
}

type DatabaseRow = {
  id: string;
  calculation_type: string;
  as_of: string;
  input_hash: string;
  code_version: string;
  status: CalculationRunRecord["status"];
  contract_version: string | null;
  input_payload: Record<string, unknown> | null;
  engine_version: string | null;
  model_version: string | null;
  output: Record<string, unknown> | null;
  diagnostics: Record<string, unknown> | null;
  warnings: string[] | null;
  duration_ms: number | null;
  failure_reason: string | null;
};

const toRecord = (row: DatabaseRow): CalculationRunRecord => ({
  id: row.id,
  calculationType: row.calculation_type,
  asOf: new Date(row.as_of).toISOString(),
  inputHash: row.input_hash,
  codeVersion: row.code_version,
  status: row.status,
  input: row.input_payload,
  response: row.output && row.contract_version && row.engine_version && row.model_version && row.duration_ms != null
    ? {
      contractVersion: "1.0",
      calculationId: row.id,
      calculationType: row.calculation_type,
      asOf: new Date(row.as_of).toISOString(),
      inputHash: row.input_hash,
      engineVersion: row.engine_version,
      modelVersion: row.model_version,
      status: row.status === "succeeded" ? "succeeded" : row.status === "degraded" ? "degraded" : "failed",
      output: row.output,
      diagnostics: row.diagnostics ?? {},
      warnings: row.warnings ?? [],
      durationMs: row.duration_ms,
    }
    : null,
  failureReason: row.failure_reason,
});

export class PostgresCalculationRunRepository {
  constructor(private readonly sql: Sql) {}

  async claim(request: AnalyticsCalculationRequest): Promise<{ record: CalculationRunRecord; claimed: boolean }> {
    const inserted = await this.sql<DatabaseRow[]>`
      INSERT INTO calculation_run (
        id, calculation_type, as_of, input_hash, code_version,
        strategy_version_id, parameter_set_id, status, contract_version, input_payload
      ) VALUES (
        ${request.calculationId}, ${request.calculationType}, ${request.asOf}, ${request.inputHash},
        ${request.codeVersion}, ${request.strategyVersion ?? null}, ${request.parameterSetVersion ?? null},
        'running', ${request.contractVersion}, ${this.sql.json(databaseJson(request.payload))}
      )
      ON CONFLICT (calculation_type, as_of, input_hash, code_version) DO NOTHING
      RETURNING id::text, calculation_type, as_of::text, input_hash, code_version, status,
        contract_version, input_payload, engine_version, model_version, output,
        diagnostics, warnings, duration_ms, failure_reason
    `;
    if (inserted[0]) return { record: toRecord(inserted[0]), claimed: true };
    const existing = await this.sql<DatabaseRow[]>`
      SELECT id::text, calculation_type, as_of::text, input_hash, code_version, status,
        contract_version, input_payload, engine_version, model_version, output,
        diagnostics, warnings, duration_ms, failure_reason
      FROM calculation_run
      WHERE calculation_type = ${request.calculationType}
        AND as_of = ${request.asOf}
        AND input_hash = ${request.inputHash}
        AND code_version = ${request.codeVersion}
    `;
    if (!existing[0]) throw new Error("Calculation run conflict could not be resolved");
    return { record: toRecord(existing[0]), claimed: false };
  }

  async complete(runId: string, response: AnalyticsCalculationResponse): Promise<CalculationRunRecord> {
    if (response.calculationId !== runId) throw new Error("Calculation response ID does not match the claimed run");
    const updated = await this.sql<DatabaseRow[]>`
      UPDATE calculation_run
      SET status = ${response.status}, engine_version = ${response.engineVersion},
          model_version = ${response.modelVersion}, output = ${this.sql.json(databaseJson(response.output))},
          diagnostics = ${this.sql.json(databaseJson(response.diagnostics))}, warnings = ${this.sql.json(databaseJson(response.warnings))},
          duration_ms = ${response.durationMs}, failure_reason = NULL, finished_at = now()
      WHERE id = ${runId} AND status = 'running'
        AND calculation_type = ${response.calculationType}
        AND input_hash = ${response.inputHash}
      RETURNING id::text, calculation_type, as_of::text, input_hash, code_version, status,
        contract_version, input_payload, engine_version, model_version, output,
        diagnostics, warnings, duration_ms, failure_reason
    `;
    if (updated[0]) return toRecord(updated[0]);
    const existing = await this.load(runId);
    if (!existing?.response) throw new Error("Calculation run could not be completed");
    return existing;
  }

  async fail(runId: string, reason: string): Promise<void> {
    await this.sql`
      UPDATE calculation_run
      SET status = 'failed', failure_reason = ${reason}, finished_at = now()
      WHERE id = ${runId} AND status = 'running'
    `;
  }

  async load(runId: string): Promise<CalculationRunRecord | null> {
    const rows = await this.sql<DatabaseRow[]>`
      SELECT id::text, calculation_type, as_of::text, input_hash, code_version, status,
        contract_version, input_payload, engine_version, model_version, output,
        diagnostics, warnings, duration_ms, failure_reason
      FROM calculation_run WHERE id = ${runId}
    `;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async loadLatestCompleted(calculationType: string): Promise<CalculationRunRecord | null> {
    const rows = await this.sql<DatabaseRow[]>`
      SELECT id::text, calculation_type, as_of::text, input_hash, code_version, status,
        contract_version, input_payload, engine_version, model_version, output,
        diagnostics, warnings, duration_ms, failure_reason
      FROM calculation_run
      WHERE calculation_type = ${calculationType}
        AND status IN ('succeeded', 'degraded')
      ORDER BY as_of DESC, finished_at DESC, id DESC
      LIMIT 1
    `;
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async loadCompletedHistory(calculationType: string, limit = 10): Promise<CalculationRunRecord[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = await this.sql<DatabaseRow[]>`
      SELECT id::text, calculation_type, as_of::text, input_hash, code_version, status,
        contract_version, input_payload, engine_version, model_version, output,
        diagnostics, warnings, duration_ms, failure_reason
      FROM (
        SELECT DISTINCT ON (as_of)
          id, calculation_type, as_of, input_hash, code_version, status,
          contract_version, input_payload, engine_version, model_version, output,
          diagnostics, warnings, duration_ms, failure_reason, finished_at
        FROM calculation_run
        WHERE calculation_type = ${calculationType}
          AND status IN ('succeeded', 'degraded')
        ORDER BY as_of DESC, finished_at DESC, id DESC
      ) AS history
      ORDER BY as_of DESC, finished_at DESC, id DESC
      LIMIT ${safeLimit}
    `;
    return rows.map(toRecord);
  }
}

export async function executeRecordedCalculation(
  repository: PostgresCalculationRunRepository,
  request: AnalyticsCalculationRequest,
): Promise<AnalyticsCalculationResponse> {
  const { record, claimed } = await repository.claim(request);
  if (!claimed) {
    if (record.response) return record.response;
    if (record.status === "failed") throw new Error(record.failureReason ?? "Previous calculation attempt failed");
    throw new Error(`Calculation ${record.id} is already running`);
  }
  const claimedRequest = { ...request, calculationId: record.id };
  try {
    const response = await runAnalyticsCalculation(claimedRequest);
    return (await repository.complete(record.id, response)).response!;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await repository.fail(record.id, message);
    throw error;
  }
}
