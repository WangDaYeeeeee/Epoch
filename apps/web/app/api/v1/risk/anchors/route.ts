import { NextResponse } from "next/server";
import { PostgresCalculationRunRepository } from "@/lib/server/calculation-run";
import { createDatabaseClient } from "@/lib/server/database";
import { PostgresRiskDriftAnchorRepository } from "@/lib/server/risk-drift-anchor";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    return NextResponse.json({ anchor: await new PostgresRiskDriftAnchorRepository(sql).loadLatest() });
  } catch (error) {
    return NextResponse.json({
      error: "risk_anchor_unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: { calculationId?: unknown; note?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_risk_anchor", detail: "Invalid JSON request" }, { status: 422 });
  }
  if (typeof body.calculationId !== "string" || (body.note != null && typeof body.note !== "string")) {
    return NextResponse.json({
      error: "invalid_risk_anchor",
      detail: "calculationId is required and note must be a string",
    }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    const run = await new PostgresCalculationRunRepository(sql).load(body.calculationId);
    if (!run) return NextResponse.json({ error: "calculation_run_not_found" }, { status: 404 });
    const anchor = await new PostgresRiskDriftAnchorRepository(sql).create(
      run,
      typeof body.note === "string" ? body.note : undefined,
    );
    return NextResponse.json({ anchor }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: "risk_anchor_unavailable",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 422 });
  } finally {
    await sql.end();
  }
}
