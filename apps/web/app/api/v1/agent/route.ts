import { NextResponse } from "next/server";
import type { AgentRunCompletion, AgentRunRequest } from "@/lib/domain/agent-gateway";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresAgentGatewayRepository } from "@/lib/server/agent-gateway";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresAgentGatewayRepository(sql);
    const runId = url.searchParams.get("runId");
    return NextResponse.json(runId
      ? { run: await repository.load(runId) }
      : { runs: await repository.list(Number(url.searchParams.get("limit") ?? 20)) });
  } catch (error) {
    return NextResponse.json({ error: "agent_gateway_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally { await sql.end(); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_agent_request", detail: "Invalid JSON request" }, { status: 422 }); }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresAgentGatewayRepository(sql);
    if (body.action === "start" && typeof body.request === "object" && body.request !== null) {
      return NextResponse.json({ run: await repository.start(body.request as AgentRunRequest) }, { status: 201 });
    }
    if (body.action === "complete" && typeof body.completion === "object" && body.completion !== null) {
      return NextResponse.json({ run: await repository.complete(body.completion as AgentRunCompletion) });
    }
    if (body.action === "fail" && typeof body.runId === "string" && typeof body.reason === "string") {
      await repository.fail(body.runId, body.reason);
      return NextResponse.json({ status: "failed" });
    }
    if (body.action === "materialize_draft" && typeof body.runId === "string") {
      return NextResponse.json(await repository.materializeDraft(body.runId), { status: 201 });
    }
    if (body.action === "evaluate_proposal" && typeof body.runId === "string") {
      return NextResponse.json({ calculation: await repository.evaluateProposal(body.runId) });
    }
    if (
      body.action === "feedback" && typeof body.runId === "string"
      && ["accepted", "modified", "rejected"].includes(String(body.disposition))
      && typeof body.comment === "string"
    ) {
      const feedbackId = await repository.feedback({
        runId: body.runId,
        disposition: body.disposition as "accepted" | "modified" | "rejected",
        comment: body.comment,
        correctedOutput: typeof body.correctedOutput === "object" && body.correctedOutput !== null
          ? body.correctedOutput as Record<string, unknown> : null,
      });
      return NextResponse.json({ feedbackId }, { status: 201 });
    }
    return NextResponse.json({ error: "invalid_agent_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_agent_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally { await sql.end(); }
}
