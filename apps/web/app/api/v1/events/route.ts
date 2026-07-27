import { NextResponse } from "next/server";
import { INVESTMENT_EVENT_TYPES, type InvestmentEventType } from "@/lib/domain/event-horizon";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresEventHorizonRepository } from "@/lib/server/event-horizon";

export const dynamic = "force-dynamic";

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export async function GET(request: Request) {
  const asOf = new URL(request.url).searchParams.get("asOf") ?? today();
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json(await new PostgresEventHorizonRepository(sql).load(asOf));
  } catch (error) {
    return NextResponse.json({ error: "event_horizon_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_event", detail: "Invalid JSON request" }, { status: 422 });
  }
  if (
    typeof body.title !== "string"
    || typeof body.eventType !== "string"
    || !INVESTMENT_EVENT_TYPES.includes(body.eventType as InvestmentEventType)
    || typeof body.scheduledDate !== "string"
    || (body.instrumentId != null && typeof body.instrumentId !== "string")
  ) return NextResponse.json({ error: "invalid_event", detail: "title, eventType and scheduledDate are required" }, { status: 422 });
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresEventHorizonRepository(sql);
    const id = await repository.create({
      title: body.title,
      eventType: body.eventType as InvestmentEventType,
      scheduledDate: body.scheduledDate,
      instrumentId: body.instrumentId as string | null | undefined,
      source: typeof body.source === "string" ? body.source : "manual",
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_event", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}

export async function PUT(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_playbook", detail: "Invalid JSON request" }, { status: 422 });
  }
  if (
    typeof body.eventId !== "string"
    || !["draft", "ready"].includes(String(body.status))
    || typeof body.summary !== "string"
  ) return NextResponse.json({ error: "invalid_playbook", detail: "eventId, status and summary are required" }, { status: 422 });
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const revisionId = await new PostgresEventHorizonRepository(sql).savePlaybook({
      eventId: body.eventId,
      status: body.status as "draft" | "ready",
      summary: body.summary,
      asOf: typeof body.asOf === "string" ? body.asOf : today(),
      branches: Array.isArray(body.branches) ? body.branches as Parameters<PostgresEventHorizonRepository["savePlaybook"]>[0]["branches"] : [],
    });
    return NextResponse.json({ status: "saved", revisionId });
  } catch (error) {
    return NextResponse.json({ error: "invalid_playbook", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally {
    await sql.end();
  }
}
