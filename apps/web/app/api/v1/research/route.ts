import { NextResponse } from "next/server";
import type { ClaimInput, EvidenceInput } from "@/lib/domain/research-evidence";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresResearchEvidenceRepository } from "@/lib/server/research-evidence";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const candidateId = new URL(request.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidate_id_required" }, { status: 422 });
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({ claims: await new PostgresResearchEvidenceRepository(sql).loadClaims(candidateId) });
  } catch (error) {
    return NextResponse.json({ error: "research_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_research_request", detail: "Invalid JSON request" }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresResearchEvidenceRepository(sql);
    if (body.action === "save_evidence" && typeof body.evidence === "object" && body.evidence !== null) {
      return NextResponse.json({
        evidenceId: await repository.saveEvidence(body.evidence as EvidenceInput),
      }, { status: 201 });
    }
    if (
      body.action === "save_claim" && typeof body.candidateId === "string"
      && typeof body.claim === "object" && body.claim !== null
    ) {
      return NextResponse.json({
        claimId: await repository.saveClaim(body.candidateId, body.claim as ClaimInput),
      }, { status: 201 });
    }
    if (
      body.action === "link_assessment" && typeof body.assessmentId === "string"
      && typeof body.claimId === "string" && ["support", "counter"].includes(String(body.role))
    ) {
      await repository.linkAssessment({
        assessmentId: body.assessmentId,
        claimId: body.claimId,
        role: body.role as "support" | "counter",
      });
      return NextResponse.json({ status: "linked" });
    }
    return NextResponse.json({ error: "invalid_research_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_research_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
