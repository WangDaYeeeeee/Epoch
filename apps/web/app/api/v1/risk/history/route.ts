import { NextResponse } from "next/server";
import { createDatabaseClient } from "@/lib/server/database";
import {
  runPortfolioRiskHistoryBackfill,
  type RiskHistoryBackfillOptions,
  type RiskHistoryFrequency,
} from "@/lib/server/portfolio-risk-history";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const frequencies = new Set<RiskHistoryFrequency>(["daily", "weekly", "monthly"]);

const parseOptions = (body: unknown): RiskHistoryBackfillOptions => {
  if (typeof body !== "object" || body === null) throw new Error("Request body must be an object");
  const value = body as Record<string, unknown>;
  if (value.frequency != null && (typeof value.frequency !== "string" || !frequencies.has(value.frequency as RiskHistoryFrequency))) {
    throw new Error("frequency must be daily, weekly, or monthly");
  }
  for (const field of ["dateFrom", "dateTo"] as const) {
    if (value[field] != null && (typeof value[field] !== "string" || !isoDate.test(value[field]))) {
      throw new Error(`${field} must be an ISO date`);
    }
  }
  if (value.limit != null && (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 500)) {
    throw new Error("limit must be an integer from 1 to 500");
  }
  return {
    frequency: value.frequency as RiskHistoryFrequency | undefined,
    dateFrom: value.dateFrom as string | undefined,
    dateTo: value.dateTo as string | undefined,
    limit: value.limit as number | undefined,
  };
};

export async function POST(request: Request) {
  let options: RiskHistoryBackfillOptions;
  try {
    options = parseOptions(await request.json());
  } catch (error) {
    return NextResponse.json({
      error: "invalid_risk_history_backfill",
      detail: error instanceof Error ? error.message : "Invalid JSON request",
    }, { status: 422 });
  }

  const sql = createDatabaseClient();
  const connection = await sql.reserve();
  let locked = false;
  try {
    const [lock] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext('portfolio-risk-history-backfill')) AS acquired
    `;
    locked = lock?.acquired === true;
    if (!locked) return NextResponse.json({ error: "risk_history_backfill_already_running" }, { status: 409 });
    return NextResponse.json({
      status: "succeeded",
      result: await runPortfolioRiskHistoryBackfill(connection, options),
    });
  } catch (error) {
    return NextResponse.json({
      error: "risk_history_backfill_failed",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503 });
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(hashtext('portfolio-risk-history-backfill'))`;
    connection.release();
    await sql.end();
  }
}
