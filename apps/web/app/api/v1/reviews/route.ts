import { NextResponse } from "next/server";
import type { ReviewInput } from "@/lib/domain/review";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresReviewRepository } from "@/lib/server/review";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({ reviews: await new PostgresReviewRepository(sql).load() });
  } catch (error) {
    return NextResponse.json({ error: "reviews_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally { await sql.end(); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: "invalid_review", detail: "Invalid JSON request" }, { status: 422 }); }
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    const repository = new PostgresReviewRepository(sql);
    if (body.action === "create" && typeof body.review === "object" && body.review !== null) {
      return NextResponse.json({ reviewId: await repository.create(body.review as ReviewInput) }, { status: 201 });
    }
    if (
      body.action === "absorb" && typeof body.reviewId === "string"
      && ["exception", "refill_not_executed"].includes(String(body.sourceType))
      && typeof body.sourceId === "string"
      && ["absorbed", "valid_exception", "no_change"].includes(String(body.disposition))
      && typeof body.rationale === "string"
    ) {
      await repository.absorb(body as Parameters<PostgresReviewRepository["absorb"]>[0]);
      return NextResponse.json({ status: "absorbed" });
    }
    return NextResponse.json({ error: "invalid_review", detail: "Unsupported action or missing fields" }, { status: 422 });
  } catch (error) {
    return NextResponse.json({ error: "invalid_review", detail: error instanceof Error ? error.message : "unknown" }, { status: 422 });
  } finally { await sql.end(); }
}
