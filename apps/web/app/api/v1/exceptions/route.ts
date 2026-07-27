import { NextResponse } from "next/server";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresExceptionRecordRepository } from "@/lib/server/exception-record";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_exception", detail: "Invalid JSON request" }, { status: 422 });
  }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresExceptionRecordRepository(sql);
    if (
      body.action === "create" && typeof body.eventId === "string"
      && typeof body.uncoveredReason === "string" && typeof body.logicChange === "string"
      && typeof body.responseAction === "string" && typeof body.decidedAt === "string"
      && typeof body.executeAfter === "string"
    ) {
      return NextResponse.json({
        exceptionId: await repository.create({
          eventId: body.eventId,
          playbookRevisionId: typeof body.playbookRevisionId === "string" ? body.playbookRevisionId : null,
          uncoveredReason: body.uncoveredReason,
          logicChange: body.logicChange,
          action: body.responseAction,
          decidedAt: body.decidedAt,
          executeAfter: body.executeAfter,
          delayWaiverReason: typeof body.delayWaiverReason === "string" ? body.delayWaiverReason : null,
        }),
      }, { status: 201 });
    }
    if (
      body.action === "review" && typeof body.exceptionId === "string"
      && ["absorbed", "valid_exception"].includes(String(body.status))
    ) {
      await repository.review(body.exceptionId, body.status as "absorbed" | "valid_exception");
      return NextResponse.json({ status: "reviewed" });
    }
    return NextResponse.json({ error: "invalid_exception", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_exception", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
