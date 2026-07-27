import { NextResponse } from "next/server";
import type { RefillBatchNumber } from "@/lib/domain/refill-plan";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresRefillPlanRepository } from "@/lib/server/refill-plan";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const planId = new URL(request.url).searchParams.get("planId");
  if (!planId) return NextResponse.json({ error: "plan_id_required" }, { status: 422 });
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({ batches: await new PostgresRefillPlanRepository(sql).load(planId) });
  } catch (error) {
    return NextResponse.json({ error: "refill_plan_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_refill_request", detail: "Invalid JSON request" }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresRefillPlanRepository(sql);
    if (body.action === "create" && typeof body.riskReductionDecisionId === "string") {
      return NextResponse.json({
        planId: await repository.create(body.riskReductionDecisionId),
      }, { status: 201 });
    }
    if (
      body.action === "evaluate" && typeof body.planId === "string"
      && [1, 2, 3].includes(Number(body.batchNumber))
      && typeof body.evaluation === "object" && body.evaluation !== null
      && Array.isArray(body.targetWeights) && typeof body.calculationRunId === "string"
    ) {
      return NextResponse.json(await repository.evaluate({
        planId: body.planId,
        batchNumber: Number(body.batchNumber) as RefillBatchNumber,
        evaluation: body.evaluation as Parameters<PostgresRefillPlanRepository["evaluate"]>[0]["evaluation"],
        targetWeights: body.targetWeights as { instrumentId: string; weight: number }[],
        calculationRunId: body.calculationRunId,
      }));
    }
    if (
      body.action === "transition" && typeof body.planId === "string"
      && [1, 2, 3].includes(Number(body.batchNumber))
      && ["executed", "not_executed"].includes(String(body.to)) && typeof body.reason === "string"
    ) {
      await repository.transition({
        planId: body.planId,
        batchNumber: Number(body.batchNumber) as RefillBatchNumber,
        to: body.to as "executed" | "not_executed",
        reason: body.reason,
      });
      return NextResponse.json({ status: "recorded" });
    }
    return NextResponse.json({ error: "invalid_refill_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_refill_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
