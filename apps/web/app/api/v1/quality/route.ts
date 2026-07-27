import { NextResponse } from "next/server";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresQualityMetricsRepository } from "@/lib/server/quality-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json(await new PostgresQualityMetricsRepository(sql).loadDashboard());
  } catch (error) {
    return NextResponse.json({ error: "quality_metrics_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally { await sql.end(); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_quality_request", detail: "Invalid JSON request" }, { status: 422 }); }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresQualityMetricsRepository(sql);
    if (body.action === "evaluate_forecasts") {
      return NextResponse.json({ inserted: await repository.evaluateMaturedForecasts() });
    }
    if (
      body.action === "record_claim_outcome" && typeof body.claimId === "string"
      && ["verified_true", "verified_false", "indeterminate"].includes(String(body.outcome))
      && typeof body.evaluatedAsOf === "string" && typeof body.rationale === "string"
    ) {
      return NextResponse.json({
        outcomeId: await repository.recordClaimOutcome({
          claimId: body.claimId,
          outcome: body.outcome as "verified_true" | "verified_false" | "indeterminate",
          evaluatedAsOf: body.evaluatedAsOf,
          rationale: body.rationale,
          evidenceId: typeof body.evidenceId === "string" ? body.evidenceId : null,
        }),
      }, { status: 201 });
    }
    return NextResponse.json({ error: "invalid_quality_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_quality_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally { await sql.end(); }
}
