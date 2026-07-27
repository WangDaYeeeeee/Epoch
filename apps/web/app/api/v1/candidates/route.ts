import { NextResponse } from "next/server";
import type { FactorAssessmentInput, WeightTierInput } from "@/lib/domain/allocation-judgment";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresAllocationJudgmentRepository } from "@/lib/server/allocation-judgment";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const candidateId = new URL(request.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidate_id_required" }, { status: 422 });
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const candidate = await new PostgresAllocationJudgmentRepository(sql).loadCandidate(candidateId);
    return candidate
      ? NextResponse.json({ candidate })
      : NextResponse.json({ error: "candidate_not_found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: "candidate_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_candidate_request", detail: "Invalid JSON request" }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresAllocationJudgmentRepository(sql);
    if (body.action === "create_candidate" && typeof body.instrumentId === "string") {
      return NextResponse.json({ candidateId: await repository.createCandidate(body.instrumentId) }, { status: 201 });
    }
    if (
      body.action === "save_assessment"
      && typeof body.candidateId === "string"
      && typeof body.assessment === "object" && body.assessment !== null
    ) {
      const assessmentId = await repository.saveAssessment(
        body.candidateId,
        body.assessment as FactorAssessmentInput,
        body.confirmed === true,
      );
      return NextResponse.json({ assessmentId }, { status: 201 });
    }
    if (
      body.action === "save_weight_tier"
      && typeof body.candidateId === "string"
      && typeof body.factorAssessmentId === "string"
      && typeof body.tier === "object" && body.tier !== null
    ) {
      const weightTierId = await repository.saveWeightTier({
        candidateId: body.candidateId,
        factorAssessmentId: body.factorAssessmentId,
        tier: body.tier as WeightTierInput,
        confirmed: body.confirmed === true,
      });
      return NextResponse.json({ weightTierId }, { status: 201 });
    }
    return NextResponse.json({ error: "invalid_candidate_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_candidate_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
