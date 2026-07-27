import { NextResponse } from "next/server";
import type { DecisionInput, ExecutionInput } from "@/lib/domain/decision-journal";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresDecisionJournalRepository } from "@/lib/server/decision-journal";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rawLimit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({
      entries: await new PostgresDecisionJournalRepository(sql).load(Number.isFinite(rawLimit) ? rawLimit : 50),
    });
  } catch (error) {
    return NextResponse.json({ error: "journal_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_journal_request", detail: "Invalid JSON request" }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresDecisionJournalRepository(sql);
    if (body.action === "decide" && typeof body.decision === "object" && body.decision !== null) {
      return NextResponse.json({
        decisionId: await repository.decide(body.decision as DecisionInput),
      }, { status: 201 });
    }
    if (body.action === "record_execution" && typeof body.execution === "object" && body.execution !== null) {
      return NextResponse.json({
        executionId: await repository.recordExecution(body.execution as ExecutionInput),
      }, { status: 201 });
    }
    return NextResponse.json({ error: "invalid_journal_request", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_journal_request", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
