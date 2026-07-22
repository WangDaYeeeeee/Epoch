import { NextResponse } from "next/server";
import { getAnalyticsHealth } from "@/lib/server/analytics-client";
import { createDatabaseClient } from "@/lib/server/database";
import { resolveDataRoot } from "@/lib/server/portfolio";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    await sql`SELECT 1`;
    const [migration] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM schema_migration`;
    const [baseline] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM raw_import WHERE source = 'normalized_satellite_baseline'
    `;
    let analytics: { status: "connected"; version: string } | { status: "unavailable"; detail: string };
    try {
      const health = await getAnalyticsHealth();
      analytics = { status: "connected", version: health.version };
    } catch (error) {
      analytics = { status: "unavailable", detail: error instanceof Error ? error.message : "unknown" };
    }
    return NextResponse.json({
      status: analytics.status === "connected" ? "ok" : "degraded",
      database: "connected",
      migrations: migration?.count ?? 0,
      analytics,
      portfolioSource: baseline?.count ? "database-baseline" : resolveDataRoot() ? "private-staging" : "synthetic",
      tradingCapability: "read_only",
    }, { status: analytics.status === "connected" ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({ status: "degraded", database: "unavailable", detail: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  } finally {
    await sql.end();
  }
}
