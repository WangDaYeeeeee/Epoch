import { NextResponse } from "next/server";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresResearchMemoryRepository } from "@/lib/server/research-memory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json({
      query,
      results: await new PostgresResearchMemoryRepository(sql).search(query, Number.isFinite(limit) ? limit : 30),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    const status = detail.includes("query") ? 422 : 503;
    return NextResponse.json({ error: status === 422 ? "invalid_memory_query" : "research_memory_unavailable", detail }, { status });
  } finally {
    await sql.end();
  }
}
