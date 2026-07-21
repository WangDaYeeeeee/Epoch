import { NextResponse } from "next/server";
import { createDatabaseClient } from "@/lib/server/database";
import { resolveDataRoot } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await sql`SELECT 1`;
    const [migration] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM schema_migration`;
    return NextResponse.json({
      status: "ok",
      database: "connected",
      migrations: migration?.count ?? 0,
      portfolioSource: resolveDataRoot() ? "private-staging" : "synthetic",
      tradingCapability: "read_only",
    });
  } catch (error) {
    return NextResponse.json({ status: "degraded", database: "unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}
