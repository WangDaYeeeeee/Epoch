import { NextResponse } from "next/server";
import { createDatabaseClient } from "@/lib/server/database";
import { runMarketDataFreshnessMonitor } from "@/lib/server/market-data-monitor";
import { confirmsMarketRefresh, executeMarketRefresh, marketRefreshPreflight } from "@/lib/server/market-refresh";
import { PostgresMarketRefreshRunRepository } from "@/lib/server/market-refresh-run";

export const dynamic = "force-dynamic";

export async function GET() {
  const sql = createDatabaseClient();
  try {
    return NextResponse.json({
      preflight: marketRefreshPreflight(),
      latestRun: await new PostgresMarketRefreshRunRepository(sql).loadLatest(),
    });
  } finally {
    await sql.end();
  }
}

export async function POST(request: Request) {
  let body: { confirmed?: unknown; fingerprint?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_market_refresh", detail: "Invalid JSON request" }, { status: 422 });
  }
  const preflight = marketRefreshPreflight();
  if (!confirmsMarketRefresh(body, preflight)) {
    return NextResponse.json({
      error: "market_refresh_confirmation_required",
      detail: "The exact current preflight fingerprint must be explicitly confirmed",
      preflight,
    }, { status: 409 });
  }

  const sql = createDatabaseClient();
  const connection = await sql.reserve();
  let locked = false;
  let runId: string | null = null;
  const repository = new PostgresMarketRefreshRunRepository(connection);
  try {
    const [lock] = await connection<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext('manual-market-refresh')) AS acquired
    `;
    locked = lock?.acquired === true;
    if (!locked) return NextResponse.json({ error: "market_refresh_already_running" }, { status: 409 });
    const run = await repository.start(preflight);
    runId = run.id;
    const result = await executeMarketRefresh();
    await runMarketDataFreshnessMonitor(connection);
    const completed = await repository.succeed(run.id, result);
    return NextResponse.json({ status: "succeeded", result, run: completed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    if (runId) {
      try {
        await repository.fail(runId, message);
      } catch {
        // Preserve the refresh failure response even if audit finalization also fails.
      }
    }
    return NextResponse.json({
      error: "market_refresh_failed",
      detail: message,
    }, { status: 503 });
  } finally {
    if (locked) await connection`SELECT pg_advisory_unlock(hashtext('manual-market-refresh'))`;
    connection.release();
    await sql.end();
  }
}
