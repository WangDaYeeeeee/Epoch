import { NextResponse } from "next/server";
import { createDatabaseClient, migrateDatabase } from "@/lib/server/database";
import { PostgresMarketSignalRepository } from "@/lib/server/market-signal";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await migrateDatabase(sql);
    return NextResponse.json(await new PostgresMarketSignalRepository(sql).coverage());
  } catch (error) {
    return NextResponse.json({ error: "market_signal_coverage_unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally { await sql.end(); }
}
