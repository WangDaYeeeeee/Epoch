import { NextResponse } from "next/server";
import type { CatalystInput, ExitType, InvalidationConditionInput } from "@/lib/domain/position-governance";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresPositionGovernanceRepository } from "@/lib/server/position-governance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const candidateId = url.searchParams.get("candidateId");
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!candidateId) return NextResponse.json({ error: "candidate_id_required" }, { status: 422 });
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json(await new PostgresPositionGovernanceRepository(sql).load(candidateId, asOf));
  } catch (error) {
    return NextResponse.json({ error: "governance_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_governance_request", detail: "Invalid JSON request" }, { status: 422 });
  }
  if (typeof body.candidateId !== "string") {
    return NextResponse.json({ error: "invalid_governance_request", detail: "candidateId is required" }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresPositionGovernanceRepository(sql);
    if (body.action === "save_catalyst" && typeof body.catalyst === "object" && body.catalyst !== null) {
      return NextResponse.json({
        catalystId: await repository.saveCatalyst(body.candidateId, body.catalyst as CatalystInput),
      }, { status: 201 });
    }
    if (body.action === "save_invalidation" && typeof body.invalidation === "object" && body.invalidation !== null) {
      return NextResponse.json({
        invalidationId: await repository.saveInvalidation(body.candidateId, body.invalidation as InvalidationConditionInput),
      }, { status: 201 });
    }
    if (
      body.action === "record_exit" && ["active_exit", "risk_reduction"].includes(String(body.exitType))
      && typeof body.exitDate === "string"
    ) {
      return NextResponse.json({
        restrictionId: await repository.recordExit({
          candidateId: body.candidateId,
          exitType: body.exitType as ExitType,
          exitDate: body.exitDate,
          executionRecordId: typeof body.executionRecordId === "string" ? body.executionRecordId : null,
        }),
      }, { status: 201 });
    }
    return NextResponse.json({ error: "invalid_governance_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_governance_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
